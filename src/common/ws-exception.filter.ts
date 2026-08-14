import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';

// BaseWsExceptionFilter only surfaces the real message for WsException;
// anything else falls back to a generic "Internal server error". HttpException
// messages (e.g. NotFoundException, thrown throughout SignalingService) are
// client-safe by design, so re-wrap them instead of masking them. Anything
// else stays masked, but still gets logged server-side.
@Catch()
export class WsExceptionFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(WsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof WsException) {
      return super.catch(exception, host);
    }

    if (exception instanceof HttpException) {
      return super.catch(new WsException(exception.message), host);
    }

    this.logger.error(
      exception instanceof Error ? exception.message : 'Unknown error',
      exception instanceof Error ? exception.stack : undefined,
    );

    return super.catch(new WsException('Internal server error'), host);
  }
}
