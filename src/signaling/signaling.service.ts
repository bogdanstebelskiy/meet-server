import { Injectable } from '@nestjs/common';
import { CreateSignalingDto } from './dto/create-signaling.dto';
import { UpdateSignalingDto } from './dto/update-signaling.dto';

@Injectable()
export class SignalingService {
  create(createSignalingDto: CreateSignalingDto) {
    return 'This action adds a new signaling';
  }

  findAll() {
    return `This action returns all signaling`;
  }

  findOne(id: number) {
    return `This action returns a #${id} signaling`;
  }

  update(id: number, updateSignalingDto: UpdateSignalingDto) {
    return `This action updates a #${id} signaling`;
  }

  remove(id: number) {
    return `This action removes a #${id} signaling`;
  }
}
