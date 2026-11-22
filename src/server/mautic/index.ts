import type { Health } from '../../contracts';
import { UpstreamError } from '../upstream';
import { items, total } from './normalize';
import type { Config } from './helpers';
import { createClient } from './client';
import { contactsApi } from './contacts';
import { segmentsApi } from './segments';
import { pointsApi } from './points';
import { formsApi } from './forms';
import { campaignsApi } from './campaigns';
import { contentApi } from './content';

// The Mautic adapter is assembled from one module per console domain (docs/parity/README.md §3).
export function createMautic(config: Config = {}) {
  const client = createClient(config);
  const { request } = client;
  return {
    async health(): Promise<Health> {
      try {
        const response = await request('/contacts?limit=1&minimal=1');
        total(response);
        items(response.contacts);
        return { status: 'ready' };
      } catch (error) {
        if (error instanceof UpstreamError && (error.status === 401 || error.status === 403)) {
          return { status: 'unavailable', message: 'Check audience API access, credentials and contact permissions.' };
        }
        return { status: 'unavailable', message: 'Check the audience service, REST API settings and connection URL.' };
      }
    },

    ...contactsApi(client),
    ...segmentsApi(client),
    ...pointsApi(client),
    ...formsApi(client),
    ...campaignsApi(client),
    ...contentApi(client),
  };
}

export const mautic = createMautic();
