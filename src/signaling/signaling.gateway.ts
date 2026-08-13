import { WebSocketGateway, SubscribeMessage, MessageBody } from '@nestjs/websockets';
import { SignalingService } from './signaling.service';
import { CreateSignalingDto } from './dto/create-signaling.dto';
import { UpdateSignalingDto } from './dto/update-signaling.dto';

@WebSocketGateway()
export class SignalingGateway {
  constructor(private readonly signalingService: SignalingService) {}

  @SubscribeMessage('createSignaling')
  create(@MessageBody() createSignalingDto: CreateSignalingDto) {
    return this.signalingService.create(createSignalingDto);
  }

  @SubscribeMessage('findAllSignaling')
  findAll() {
    return this.signalingService.findAll();
  }

  @SubscribeMessage('findOneSignaling')
  findOne(@MessageBody() id: number) {
    return this.signalingService.findOne(id);
  }

  @SubscribeMessage('updateSignaling')
  update(@MessageBody() updateSignalingDto: UpdateSignalingDto) {
    return this.signalingService.update(updateSignalingDto.id, updateSignalingDto);
  }

  @SubscribeMessage('removeSignaling')
  remove(@MessageBody() id: number) {
    return this.signalingService.remove(id);
  }
}
