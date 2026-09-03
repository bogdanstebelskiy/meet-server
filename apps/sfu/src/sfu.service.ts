import { Injectable } from '@nestjs/common';

@Injectable()
export class SfuService {
  getHello(): string {
    return 'Hello World!';
  }
}
