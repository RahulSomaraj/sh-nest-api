import { PartialType } from '@nestjs/mapped-types';
import { CreateAdministratorDto } from './create-administrator.dto';

// modify() does findOneAndUpdate($set, body); all fields optional.
export class UpdateAdministratorDto extends PartialType(CreateAdministratorDto) {}
