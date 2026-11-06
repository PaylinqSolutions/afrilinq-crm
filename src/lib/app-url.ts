/** Public base URL for links sent to customers and invitees. Falls back to the address the host assigns (Fly, Railway, Render). */
export const appUrl = () =>
  process.env.APP_URL
  || (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : "")
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")
  || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
