### New

- Cloud Sync reaches a WebDAV or S3-compatible server at a plain `http://` address, such as a NAS on your home network; a line under the address warns that the password and files then travel unencrypted. (#852)

### Platform notes

- Plugins granted `network:*` (an address the user types) may make plain HTTP requests, and no plugin request follows a redirect from HTTPS to HTTP.
- **macOS, iPhone and iPad:** the system's Local Network prompt now says why Textus asks: to reach a server you set up on your network.
