/** Developer commands need WST_DEV_TOOLS=1, and are never on in a production server (NODE_ENV=production, which the Docker image sets). */
export const devToolsEnabled = (env: Readonly<Record<string, string | undefined>> = process.env): boolean =>
  env.WST_DEV_TOOLS === '1' && env.NODE_ENV !== 'production';
