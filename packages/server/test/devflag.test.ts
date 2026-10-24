import { describe, expect, it } from 'vitest';
import { devToolsEnabled } from '../src/devTools';

describe('developer commands switch', () => {
  it('is off unless WST_DEV_TOOLS is exactly 1', () => {
    expect(devToolsEnabled({})).toBe(false);
    expect(devToolsEnabled({ WST_DEV_TOOLS: '0' })).toBe(false);
    expect(devToolsEnabled({ WST_DEV_TOOLS: 'true' })).toBe(false);
    expect(devToolsEnabled({ WST_DEV_TOOLS: '1' })).toBe(true);
  });

  it('stays off in a production server whatever else is set', () => {
    expect(devToolsEnabled({ WST_DEV_TOOLS: '1', NODE_ENV: 'production' })).toBe(false);
    expect(devToolsEnabled({ WST_DEV_TOOLS: '1', NODE_ENV: 'development' })).toBe(true);
  });
});
