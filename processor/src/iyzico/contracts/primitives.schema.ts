import { z } from 'zod';

const decimalCharacters = new Set('0123456789.eE+-');

const iyzicoDecimalStringSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) =>
    [...value].every((character) => decimalCharacters.has(character)),
  )
  .refine((value) => Number.isFinite(Number(value)));

/** Iyzico returns monetary amounts either as numbers or as decimal strings. */
export const iyzicoDecimalSchema = z
  .union([z.number(), iyzicoDecimalStringSchema])
  .transform(Number)
  .pipe(z.number().finite());

/** Iyzico returns identifiers either as numbers or as strings; the connector always uses strings. */
export const iyzicoIdentifierSchema = z
  .union([z.string().min(1), z.number().int().nonnegative()])
  .transform((value) => String(value));

/** Iyzico error codes are numbers on some endpoints and strings on others. */
export const iyzicoErrorCodeSchema = z.union([z.number(), z.string()]);
