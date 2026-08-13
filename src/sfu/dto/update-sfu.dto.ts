import { PartialType } from '@nestjs/mapped-types';
import { CreateSfuDto } from './create-sfu.dto';

export class UpdateSfuDto extends PartialType(CreateSfuDto) {}
