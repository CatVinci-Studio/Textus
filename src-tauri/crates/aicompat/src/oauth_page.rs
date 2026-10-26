/// A small HTML page shown in the browser after finishing an OAuth login.
pub fn success_page_html(provider_name: &str, app_name: &str) -> String {
    format!(
        r#"<!doctype html>
<html><head><meta charset="utf-8"><title>{app_name}</title>
<style>
  body {{
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: #1e1e1e;
    color: #d8d6d0;
    font-family: -apple-system, "SF Pro Text", "PingFang SC", "Noto Sans SC", Inter, system-ui, sans-serif;
  }}
  .card {{
    text-align: center;
    padding: 2.5rem 3rem;
  }}
  .check {{
    width: 48px;
    height: 48px;
    margin: 0 auto 1rem;
    border-radius: 50%;
    background: #6c9bf7;
    display: flex;
    align-items: center;
    justify-content: center;
  }}
  h1 {{ font-size: 18px; font-weight: 650; margin: 0 0 0.4rem; }}
  p {{ font-size: 14px; color: #8c8c8c; margin: 0; }}
</style></head>
<body>
  <div class="card">
    <div class="check">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M5 13l4 4L19 7" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h1>{provider_name} connected</h1>
    <p>You can close this window and go back to {app_name}.</p>
  </div>
</body></html>"#
    )
}
