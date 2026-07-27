import { PartialType } from '@nestjs/swagger';
import { CreateAdministratorDto } from './create-administrator.dto';

// modify() does findOneAndUpdate($set, body); all fields optional.
export class UpdateAdministratorDto extends PartialType(CreateAdministratorDto) {}
