import { NestFactory } from '@nestjs/core';
import { SfuModule } from './sfu.module';

async function bootstrap() {
  const app = await NestFactory.create(SfuModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
