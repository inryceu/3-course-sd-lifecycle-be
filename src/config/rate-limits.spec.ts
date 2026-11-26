import { globalLimit, loginLimit, registerLimit } from './rate-limits';

describe('rate limits', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('uses the T-36 defaults when nothing is set', () => {
    delete process.env['RATE_LIMIT_PER_MINUTE'];
    delete process.env['RATE_LIMIT_REGISTER'];
    delete process.env['RATE_LIMIT_LOGIN'];
    expect([globalLimit(), registerLimit(), loginLimit()]).toEqual([100, 5, 10]);
  });

  it('reads overrides from the environment at call time', () => {
    process.env['RATE_LIMIT_PER_MINUTE'] = '5000';
    process.env['RATE_LIMIT_REGISTER'] = '200';
    process.env['RATE_LIMIT_LOGIN'] = '300';
    expect([globalLimit(), registerLimit(), loginLimit()]).toEqual([5000, 200, 300]);
  });

  it('falls back to the default for invalid values', () => {
    process.env['RATE_LIMIT_LOGIN'] = '0';
    process.env['RATE_LIMIT_REGISTER'] = 'many';
    expect([loginLimit(), registerLimit()]).toEqual([10, 5]);
  });
});
