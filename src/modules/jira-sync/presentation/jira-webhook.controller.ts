import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { JiraWebhookService } from '../application/jira-webhook.service';

@ApiTags('jira')
@Controller('jira')
export class JiraWebhookController {
  constructor(private readonly webhooks: JiraWebhookService) {}

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive a signed Jira webhook delivery' })
  @ApiResponse({ status: 200, description: 'Processed or ignored delivery' })
  @ApiResponse({ status: 400, description: 'Malformed JSON or payload' })
  @ApiResponse({ status: 401, description: 'Missing or invalid authenticity proof' })
  receive(@Req() request: RawBodyRequest<Request>): Promise<void> {
    if (!request.rawBody) {
      throw new BadRequestException('Raw body is required');
    }
    return this.webhooks.receive(request.rawBody, request.body, request.headers);
  }
}
