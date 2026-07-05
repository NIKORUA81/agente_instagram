import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { INVITABLE_ROLES, ROLES, type InvitableRole, type Role } from '@wolfiax/shared';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'ana@empresa.com' })
  @IsEmail({}, { message: 'email debe ser un correo válido' })
  email!: string;

  @ApiProperty({ minLength: 10, example: 'contraseña-larga-y-unica' })
  @IsString()
  @MinLength(10, { message: 'password debe tener al menos 10 caracteres' })
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'Ana García' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  full_name!: string;

  @ApiProperty({ example: 'Café París' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  organization_name!: string;
}

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class SwitchOrgDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organization_id!: string;
}

export class AcceptInvitationDto {
  /** Requerido solo si el email invitado aún no tiene cuenta. */
  @ApiPropertyOptional({ example: 'Ana García' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  full_name?: string;

  @ApiPropertyOptional({ minLength: 10 })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password?: string;
}

export class CreateInvitationDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: INVITABLE_ROLES })
  @IsIn(INVITABLE_ROLES as readonly string[])
  role!: InvitableRole;
}

export class UpdateMemberDto {
  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES as readonly string[])
  role!: Role;
}

export class UpdateOrgDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;
}
