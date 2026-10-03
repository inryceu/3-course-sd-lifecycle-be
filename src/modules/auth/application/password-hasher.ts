import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

@Injectable()
export class PasswordHasher {
  private dummyHash?: Promise<string>;

  constructor(private readonly config: ConfigService) {}

  private get rounds(): number {
    return this.config.getOrThrow<number>('jwt.bcryptRounds');
  }

  hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.rounds);
  }

  compare(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Spends the same time as a real comparison. Used when the e-mail is unknown so that response
   * time does not reveal which e-mails are registered.
   */
  async compareAgainstDummy(password: string): Promise<void> {
    this.dummyHash ??= bcrypt.hash('boardsync-dummy-password', this.rounds);
    await bcrypt.compare(password, await this.dummyHash);
  }
}
