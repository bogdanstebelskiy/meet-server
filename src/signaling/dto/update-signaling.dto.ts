import { PartialType } from '@nestjs/mapped-types';
import { CreateSignalingDto } from './create-signaling.dto';

export class UpdateSignalingDto extends PartialType(CreateSignalingDto) {
  id: number;
}
