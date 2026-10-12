import api from './api';
import type { WidgetSettings } from './types';

export async function getSettings(agent_id: string): Promise<WidgetSettings> {
  const response = await api({
    endpoint: 'agents/settings',
    method: 'GET',
    headers: {
      'X-AGENT-ID': agent_id
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch settings');
  }

  return await response.json();
}
