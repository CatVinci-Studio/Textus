use super::provider::{self, MediaError};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use std::{io::Cursor, net::IpAddr, time::Duration};
use tauri::AppHandle;

pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

pub struct GeneratedImage {
    pub bytes: Vec<u8>,
    pub ext: &'static str,
    pub width: u32,
    pub height: u32,
    pub model: String,
}

pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && (b == 168 || b == 0 || (b == 88 && c == 99)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            let s = ip.segments();
            // Global unicast only; exclude transition/translation, benchmark,
            // documentation and special-purpose prefixes conservatively.
            (s[0] & 0xe000) == 0x2000
                && s[0] != 0x2002
                && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
                && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}

pub fn validate_image(bytes: &[u8]) -> Result<(&'static str, u32, u32), MediaError> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err(MediaError::new("limit", "Image is empty or exceeds 20 MiB"));
    }
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| MediaError::new("invalid_image", "Cannot identify image format"))?;
    let ext = match reader.format() {
        Some(image::ImageFormat::Png) => "png",
        Some(image::ImageFormat::Jpeg) => "jpg",
        Some(image::ImageFormat::WebP) => "webp",
        _ => {
            return Err(MediaError::new(
                "invalid_image",
                "Only PNG, JPEG and WebP images are accepted",
            ))
        }
    };
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(2048);
    limits.max_image_height = Some(2048);
    limits.max_alloc = Some(32 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|_| {
        MediaError::new(
            "invalid_image",
            "Image is corrupt or exceeds 2048×2048 pixels",
        )
    })?;
    Ok((ext, decoded.width(), decoded.height()))
}

/// The configured API endpoint is user-chosen. A returned download URL is
/// untrusted: pin the verified public DNS result and bypass system proxies.
async fn download(url: &str) -> Result<Vec<u8>, MediaError> {
    let url = reqwest::Url::parse(url)
        .map_err(|_| MediaError::new("invalid_url", "Invalid generated-image URL"))?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err(MediaError::new(
            "invalid_url",
            "Image downloads require a public HTTPS URL without credentials",
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| MediaError::new("invalid_url", "Image URL has no host"))?;
    let addresses: Vec<_> = tokio::net::lookup_host((
        host.trim_matches(['[', ']']),
        url.port_or_known_default().unwrap_or(443),
    ))
    .await
    .map_err(|_| MediaError::new("network", "Cannot resolve generated-image host"))?
    .collect();
    if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
        return Err(MediaError::new(
            "invalid_url",
            "Image URL resolved to a non-public address",
        ));
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, &addresses)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| MediaError::new("network", "Cannot create image download client"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(provider::network_error)?;
    provider::read_response(response, MAX_IMAGE_BYTES).await
}

pub async fn generate(
    app: &AppHandle,
    prompt: &str,
    size: &str,
    quality: Option<&str>,
) -> Result<GeneratedImage, MediaError> {
    if prompt.trim().is_empty()
        || prompt.chars().count() > 12000
        || !matches!(
            size,
            "1024x1024" | "1536x1024" | "1024x1536" | "1792x1024" | "1024x1792"
        )
    {
        return Err(MediaError::new(
            "invalid_request",
            "Specify a prompt up to 12000 characters and a supported image size",
        ));
    }
    let (request, config) = provider::request(app, "image", "images/generations")?;
    let mut payload = json!({"model":config.model,"prompt":prompt,"size":size,"n":1});
    // GPT image models return base64 intrinsically; older/compatible image
    // APIs use response_format. Keep that protocol choice in the adapter.
    if config.provider == "openai-compatible" || !config.model.starts_with("gpt-image") {
        payload["response_format"] = json!("b64_json");
    }
    if let Some(quality) = quality {
        if !matches!(
            quality,
            "auto" | "low" | "medium" | "high" | "standard" | "hd"
        ) {
            return Err(MediaError::new(
                "invalid_request",
                "Unsupported image quality",
            ));
        }
        payload["quality"] = json!(quality);
    }
    let response = request
        .json(&payload)
        .send()
        .await
        .map_err(provider::network_error)?;
    let raw =
        provider::read_response(response, (MAX_IMAGE_BYTES + 2) / 3 * 4 + 1024 * 1024).await?;
    let response: serde_json::Value = serde_json::from_slice(&raw)
        .map_err(|_| MediaError::new("invalid_response", "Image provider returned invalid JSON"))?;
    let first = response
        .get("data")
        .and_then(|v| v.as_array())
        .and_then(|v| if v.len() == 1 { v.first() } else { None })
        .ok_or_else(|| {
            MediaError::new("invalid_response", "Expected exactly one generated image")
        })?;
    let bytes = if let Some(encoded) = first.get("b64_json").and_then(|v| v.as_str()) {
        STANDARD.decode(encoded).map_err(|_| {
            MediaError::new(
                "invalid_image",
                "Provider returned invalid base64 image data",
            )
        })?
    } else if let Some(url) = first.get("url").and_then(|v| v.as_str()) {
        download(url).await?
    } else {
        return Err(MediaError::new(
            "invalid_response",
            "Provider returned neither image data nor a URL",
        ));
    };
    let (ext, width, height) = validate_image(&bytes)?;
    Ok(GeneratedImage {
        bytes,
        ext,
        width,
        height,
        model: config.model,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_private_and_special_download_addresses() {
        for address in [
            "127.0.0.1",
            "10.2.3.4",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "0.0.0.0",
            "100.64.0.1",
            "198.18.0.1",
            "224.0.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
        ] {
            assert!(!public_ip(address.parse().unwrap()), "{address}");
        }
        assert!(public_ip("8.8.8.8".parse().unwrap()));
        assert!(public_ip("2606:4700:4700::1111".parse().unwrap()));
    }
    #[test]
    fn validates_actual_image_content_and_rejects_empty_or_forged_data() {
        let mut output = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(1, 1)
            .write_to(&mut output, image::ImageFormat::Png)
            .unwrap();
        let valid = output.into_inner();
        assert!(validate_image(&valid).is_ok());
        assert!(validate_image(b"<svg xmlns='http://www.w3.org/2000/svg'/>").is_err());
        assert!(validate_image(&[]).is_err());
        assert!(validate_image(&valid[..24]).is_err());
    }
}
