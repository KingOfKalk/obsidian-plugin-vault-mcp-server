# Security Best Practices

## Bearer Authentication

- **Off by default**: Bearer authentication is opt-in via the **Require Bearer authentication** toggle in Server Settings. With it off the server accepts every request without an `Authorization` header — only safe on a trusted, localhost-only setup.
- **Turn it on for any non-local exposure**: If you bind the server to anything other than `127.0.0.1`, or share the host with anyone you don't trust, enable the toggle and configure an access key.

## Access Key Management

- **Generate a strong key**: Use the "Generate" button to create a random 64-character hex key
- **Don't share your key**: The access key grants full access to enabled vault operations
- **Rotate regularly**: Generate a new key periodically, especially if you suspect exposure
- **Don't commit keys**: Never store access keys in version control

## Network Exposure

- **Localhost by default**: The server binds to `127.0.0.1` by default — it's not accessible from other machines. This can be changed in settings via the **Server Address** option.
- **Binding to `0.0.0.0`**: Exposes the server on all network interfaces. Only do this if you understand the security implications and have an access key configured.
- **Firewall**: If running on a shared machine or binding to a non-localhost address, ensure your firewall blocks the MCP port from unauthorized access
- **HTTPS**: Enable HTTPS for encrypted communication, especially when binding to a non-localhost address. The plugin generates and caches a self-signed certificate; clients must explicitly trust it (e.g. Node clients need `--cafile` or the `ca` option, curl `--cacert`). Since the certificate is locally issued it cannot be verified against a public CA.

## TLS Certificate

When HTTPS is enabled, a self-signed RSA-2048 certificate (SHA-256, 365-day validity) is generated on first start and cached in `data.json`. The subject alternative name list includes `localhost`, `127.0.0.1`, `::1`, and the configured server address. Use the **Regenerate certificate** button in settings if you rotate the server address or want a fresh key pair; clients that previously trusted the old certificate must re-trust the new one.

## Feature Access Control

- **Disable unused modules**: Only enable the feature categories you need. Each module is all-or-nothing — when enabled, every tool it ships is exposed.
- **Principle of least privilege**: Start with minimal permissions and expand as needed

## Path Traversal Protection

All file operations validate paths to ensure they stay within the vault directory. The following are rejected:
- `../` directory traversal
- Backslash paths (`\`)
- Null bytes
- Percent-encoded traversal sequences (`%2e`, `%2f`, `%5c`)

## CORS

CORS headers are restrictive by default, allowing only `http://localhost` origin. This prevents unauthorized web pages from making requests to your MCP server.

## Logging

- Access keys are **never** included in log output, even in debug mode
- Debug mode logs all MCP requests and responses (useful for troubleshooting)
- Structured JSON logging with timestamps and log levels
