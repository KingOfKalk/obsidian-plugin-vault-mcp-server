# Security Best Practices

## Access Key Management

- **Generate a strong key**: Use the "Generate" button to create a random 64-character hex key
- **Don't share your key**: The access key grants full access to enabled vault operations
- **Rotate regularly**: Generate a new key periodically, especially if you suspect exposure
- **Don't commit keys**: Never store access keys in version control

## Network Exposure

- **Localhost only**: The server binds to `127.0.0.1` by default — it's not accessible from other machines
- **Firewall**: If running on a shared machine, ensure your firewall blocks the MCP port from external access
- **HTTPS**: Enable HTTPS for encrypted communication, even on localhost

## Feature Access Control

- **Disable unused modules**: Only enable the feature categories you need
- **Use read-only mode**: For modules that support it (Vault, Editor, Templates), enable read-only mode to prevent modifications
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
