import { ApiProperty } from '@nestjs/swagger';

export class UserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'email' })
  email: string;

  @ApiProperty()
  displayName: string;
}

export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ description: 'Lifetime in seconds (at most 3600)' })
  expiresIn: number;

  @ApiProperty({ type: UserDto })
  user: UserDto;
}
