// LAN HTTP deployments and HTTPS deployments share the same app. Express
// resolves req.secure from TLS or the configured trusted reverse proxy.
export function sessionCookieOptions(req, path, maxAge) {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: Boolean(req.secure),
    path,
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}
