import * as fs from 'fs';
import * as path from 'path';

import { config } from 'dotenv';
config({
  path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
  override: true,
});

export function generateFrontConfig(): void {
  if (process.env.AUTH_TYPE === 'SSO' && !process.env.SMB_NAME) {
    // SMB_NAME is required when AUTH_TYPE=SSO. No default — fail loudly so
    // the SPA never silently rewrites the logout host to the wrong domain.
    // Same env name across every devstack app — see sso-rules RULES.md
    // §1 Logout.
    throw new Error(
      'SMB_NAME env is required when AUTH_TYPE=SSO. Set it to the portal hostname prefix (e.g. "moneta").',
    );
  }

  const configObject = {
    window: {
      _env_: {
        REACT_APP_SERVER_BASE_URL: process.env.SERVER_URL,
        AUTH_TYPE: process.env.AUTH_TYPE ?? '',
        SMB_NAME: process.env.SMB_NAME ?? '',
      },
    },
  };

  const configString = `<!-- BEGIN: Twenty Config -->
    <script id="twenty-env-config">
      window._env_ = ${JSON.stringify(configObject.window._env_, null, 2)};
    </script>
    <!-- END: Twenty Config -->`;

  const distPath = path.join(__dirname, '..', 'front');
  const indexPath = path.join(distPath, 'index.html');

  try {
    let indexContent = fs.readFileSync(indexPath, 'utf8');

    indexContent = indexContent.replace(
      /<!-- BEGIN: Twenty Config -->[\s\S]*?<!-- END: Twenty Config -->/,
      configString,
    );

    fs.writeFileSync(indexPath, indexContent, 'utf8');
  } catch {
    // oxlint-disable-next-line no-console
    console.log(
      'Frontend build not found or not writable, assuming it is served independently',
    );
  }
}
