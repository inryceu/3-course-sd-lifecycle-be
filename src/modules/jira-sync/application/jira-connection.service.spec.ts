import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BoardRole } from '../../boards';
import { JiraConnectionEntity } from '../infrastructure/persistence/jira-connection.entity';
import { JiraConnectionService } from './jira-connection.service';

function setup(role: BoardRole | null, connection: Partial<JiraConnectionEntity> | null = null) {
  const connections = {
    findOne: jest.fn().mockResolvedValue(connection),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const boards = { getMemberRole: jest.fn().mockResolvedValue(role) };
  const service = new JiraConnectionService(
    connections as unknown as Repository<JiraConnectionEntity>,
    boards,
  );
  return { service, connections };
}

const stored = {
  cloudId: 'cloud-1',
  siteUrl: 'https://acme.atlassian.net',
  scopes: ['read:jira-work'],
  expiresAt: new Date('2026-10-03T11:00:00Z'),
  connectedAt: new Date('2026-10-03T10:00:00Z'),
  accessTokenEnc: 'must-not-leak',
  refreshTokenEnc: 'must-not-leak-either',
};

describe('JiraConnectionService', () => {
  it('reports a connected board without any token', async () => {
    const { service } = setup(BoardRole.VIEWER, stored);

    const status = await service.getStatus('u', 'b');

    expect(status).toMatchObject({
      connected: true,
      boardId: 'b',
      cloudId: 'cloud-1',
      siteUrl: 'https://acme.atlassian.net',
      scopes: ['read:jira-work'],
      expiresAt: '2026-10-03T11:00:00.000Z',
    });
    expect(JSON.stringify(status)).not.toMatch(/must-not-leak|token/i);
  });

  it('reports connected false when no connection exists', async () => {
    const { service } = setup(BoardRole.MEMBER);
    expect(await service.getStatus('u', 'b')).toMatchObject({ connected: false, cloudId: null });
  });

  it('answers 404 for non-members', async () => {
    const { service } = setup(null);
    await expect(service.getStatus('u', 'b')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.disconnect('u', 'b')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets the admin disconnect, deleting the stored credentials', async () => {
    const { service, connections } = setup(BoardRole.ADMIN, stored);
    await service.disconnect('u', 'b');
    expect(connections.delete).toHaveBeenCalledWith({ boardId: 'b' });
  });

  it.each([BoardRole.MEMBER, BoardRole.VIEWER])('refuses %s to disconnect', async (role) => {
    const { service, connections } = setup(role, stored);
    await expect(service.disconnect('u', 'b')).rejects.toBeInstanceOf(ForbiddenException);
    expect(connections.delete).not.toHaveBeenCalled();
  });
});
