import { JwtService } from '@nestjs/jwt';
import { AuthUser } from '../domain/auth-user';
import { AuthFacadeService } from './auth-facade.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

const SECRET = 'unit-test-secret-with-at-least-32-characters';
const user: AuthUser = { id: 'u1', email: 'a@b.co', displayName: 'A' };

function setup(existing: AuthUser | null = user) {
  const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '1h' } });
  const auth = { getUser: jest.fn().mockResolvedValue(existing) } as unknown as AuthService;
  const facade = new AuthFacadeService(auth, new TokenService(jwt));
  return { facade, jwt, auth };
}

describe('AuthFacadeService', () => {
  it('returns a user by id', async () => {
    const { facade } = setup();
    expect(await facade.getUserById('u1')).toEqual(user);
  });

  it('returns null when the user does not exist', async () => {
    const { facade } = setup(null);
    expect(await facade.getUserById('nope')).toBeNull();
  });

  it('verifies a valid token and returns the user', async () => {
    const { facade, jwt } = setup();
    const token = jwt.sign({ sub: 'u1', email: user.email });
    expect(await facade.verifyToken(token)).toEqual(user);
  });

  it('returns null for a tampered token', async () => {
    const { facade, jwt } = setup();
    const token = jwt.sign({ sub: 'u1', email: user.email });
    const tampered = `${token.slice(0, -3)}abc`;
    expect(await facade.verifyToken(tampered)).toBeNull();
  });

  it('returns null for a token signed with another secret', async () => {
    const { facade } = setup();
    const other = new JwtService({ secret: 'another-secret-with-at-least-32-characters' });
    expect(await facade.verifyToken(other.sign({ sub: 'u1', email: user.email }))).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const { facade, jwt } = setup();
    const expired = jwt.sign({ sub: 'u1', email: user.email }, { expiresIn: '-10s' });
    expect(await facade.verifyToken(expired)).toBeNull();
  });

  it('returns null for garbage', async () => {
    const { facade } = setup();
    expect(await facade.verifyToken('not-a-jwt')).toBeNull();
  });

  it('returns null when the account behind a valid token was deleted', async () => {
    const { facade, jwt } = setup(null);
    expect(await facade.verifyToken(jwt.sign({ sub: 'gone', email: 'x@y.z' }))).toBeNull();
  });
});
