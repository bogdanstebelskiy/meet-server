import { Test, TestingModule } from '@nestjs/testing';
import { SfuController } from './sfu.controller';
import { SfuService } from './sfu.service';

describe('SfuController', () => {
  let sfuController: SfuController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [SfuController],
      providers: [SfuService],
    }).compile();

    sfuController = app.get<SfuController>(SfuController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(sfuController.getHello()).toBe('Hello World!');
    });
  });
});
