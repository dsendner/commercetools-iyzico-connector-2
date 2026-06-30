import { Test, TestingModule } from '@nestjs/testing';
import { randomBytes, createHmac } from 'crypto';
import { IyzicoSignatureService } from '../src/iyzico/iyzico-signature.service';

jest.mock('crypto', () => ({
  randomBytes: jest.fn(),
  createHmac: jest.fn(),
}));

describe('IyzicoSignatureService', () => {
  let service: IyzicoSignatureService;

  const mockRandomKey = 'mock-random-key';
  const mockApiKey = 'test-api-key';
  const mockSecretKey = 'test-secret-key';
  const path = '/payment/bin/check';
  const body = JSON.stringify({ binNumber: '41579200' });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IyzicoSignatureService],
    }).compile();

    service = module.get<IyzicoSignatureService>(IyzicoSignatureService);

    (randomBytes as jest.Mock).mockReturnValue({
      toString: () => mockRandomKey,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateRandomKey', () => {
    it('should generate hex random key', () => {
      const result = service.generateRandomKey();

      expect(randomBytes).toHaveBeenCalledWith(16);
      expect(result).toBe(mockRandomKey);
    });
  });

  describe('computeSignature', () => {
    it('should compute HMAC SHA256 signature in hex format', () => {
      const digestMock = jest.fn().mockReturnValue('mock-signature');

      (createHmac as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnValue({
          digest: digestMock,
        }),
      });

      const result = service.computeSignature(
        mockSecretKey,
        mockRandomKey,
        path,
        body,
      );

      const expectedPayload = mockRandomKey + path + body;

      expect(createHmac).toHaveBeenCalledWith(
        'sha256',
        mockSecretKey,
      );

      expect(result).toBe('mock-signature');
    });

    it('should handle empty body', () => {
      const digestMock = jest.fn().mockReturnValue('sig');

      (createHmac as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnValue({
          digest: digestMock,
        }),
      });

      const result = service.computeSignature(
        mockSecretKey,
        mockRandomKey,
        path,
      );

      expect(result).toBe('sig');
    });
  });

  describe('buildAuthHeader', () => {
    it('should return valid Authorization header structure', () => {
      const digestMock = jest.fn().mockReturnValue('signature123');

      (createHmac as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnValue({
          digest: digestMock,
        }),
      });

      const result = service.buildAuthHeader(
        mockApiKey,
        mockSecretKey,
        path,
        body,
      );

      expect(result).toHaveProperty('Authorization');
      expect(result).toHaveProperty('x-iyzi-rnd');

      expect(result['x-iyzi-rnd']).toBe(mockRandomKey);

      expect(result.Authorization).toContain('IYZWSv2 ');
    });

    it('should base64 encode correct auth string format', () => {
      const digestMock = jest.fn().mockReturnValue('signature123');

      (createHmac as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnValue({
          digest: digestMock,
        }),
      });

      const result = service.buildAuthHeader(
        mockApiKey,
        mockSecretKey,
        path,
        body,
      );

      const encoded = result.Authorization.replace('IYZWSv2 ', '');
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');

      expect(decoded).toContain(mockApiKey);
      expect(decoded).toContain('signature123');
      expect(decoded).toContain(mockRandomKey);
    });

    it('should work without body', () => {
      const digestMock = jest.fn().mockReturnValue('sig');

      (createHmac as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnValue({
          digest: digestMock,
        }),
      });

      const result = service.buildAuthHeader(
        mockApiKey,
        mockSecretKey,
        path,
      );

      expect(result.Authorization).toBeDefined();
    });
  });
});