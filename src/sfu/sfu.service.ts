import { Injectable } from '@nestjs/common';
import { CreateSfuDto } from './dto/create-sfu.dto';
import { UpdateSfuDto } from './dto/update-sfu.dto';

@Injectable()
export class SfuService {
  create(createSfuDto: CreateSfuDto) {
    return 'This action adds a new sfu';
  }

  findAll() {
    return `This action returns all sfu`;
  }

  findOne(id: number) {
    return `This action returns a #${id} sfu`;
  }

  update(id: number, updateSfuDto: UpdateSfuDto) {
    return `This action updates a #${id} sfu`;
  }

  remove(id: number) {
    return `This action removes a #${id} sfu`;
  }
}
