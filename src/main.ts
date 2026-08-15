import * as fs from 'node:fs';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function loadHttpsOptions() {
  const certDir = path.join(__dirname, '..', 'certificates');
  const keyPath = path.join(certDir, 'localhost-key.pem');
  const certPath = path.join(certDir, 'localhost.pem');

  if (!fs.existsSync(keyPath)) {
    return undefined;
  }

  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    httpsOptions: loadHttpsOptions(),
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
