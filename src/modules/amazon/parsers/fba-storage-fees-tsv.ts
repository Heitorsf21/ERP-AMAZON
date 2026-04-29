import {
  compactKey,
  parseCentavos,
  parseMonthOrNull,
  parseNumber,
  parseTsvRecords,
  pick,
  type TsvRecord,
} from "@/modules/amazon/parsers/report-utils";

export interface FbaStorageFeeRow {
  naturalKey: string;
  asin: string | null;
  fnSku: string | null;
  productName: string | null;
  fulfillmentCenter: string | null;
  countryCode: string | null;
  monthOfCharge: Date | null;
  storageRate: number | null;
  currency: string | null;
  averageQuantityOnHand: number | null;
  averageQuantityPendingRemoval: number | null;
  estimatedTotalItemVolume: number | null;
  itemVolume: number | null;
  volumeUnits: string | null;
  productSizeTier: string | null;
  storageFeeCentavos: number;
  dangerousGoodsStorageType: string | null;
  payload: TsvRecord;
}

export function parseFbaStorageFeesTsv(
  input: Buffer | string,
): FbaStorageFeeRow[] {
  return parseTsvRecords(input)
    .map((row) => {
      const asin = nullable(pick(row, ["asin"]));
      const fnSku = nullable(pick(row, ["fnsku", "fn-sku"]));
      const monthOfCharge = parseMonthOrNull(
        pick(row, ["month-of-charge", "month", "charged-month"]),
      );
      const storageFeeCentavos = parseCentavos(
        pick(row, [
          "estimated-monthly-storage-fee",
          "monthly-storage-fee",
          "storage-fee",
          "fee",
        ]),
      );

      return {
        naturalKey: compactKey([
          asin,
          fnSku,
          monthOfCharge,
          pick(row, ["fulfillment-center", "fulfillment-center-id"]),
          storageFeeCentavos,
        ]),
        asin,
        fnSku,
        productName: nullable(pick(row, ["product-name", "title"])),
        fulfillmentCenter: nullable(
          pick(row, ["fulfillment-center", "fulfillment-center-id"]),
        ),
        countryCode: nullable(pick(row, ["country-code", "country"])),
        monthOfCharge,
        storageRate: parseNumber(pick(row, ["storage-rate", "rate"])),
        currency: nullable(pick(row, ["currency", "currency-code"])),
        averageQuantityOnHand: parseNumber(
          pick(row, ["average-quantity-on-hand", "avg-quantity-on-hand"]),
        ),
        averageQuantityPendingRemoval: parseNumber(
          pick(row, [
            "average-quantity-pending-removal",
            "avg-quantity-pending-removal",
          ]),
        ),
        estimatedTotalItemVolume: parseNumber(
          pick(row, [
            "estimated-total-item-volume",
            "estimated-total-volume",
            "total-item-volume",
          ]),
        ),
        itemVolume: parseNumber(pick(row, ["item-volume", "volume"])),
        volumeUnits: nullable(pick(row, ["volume-units", "volume-unit"])),
        productSizeTier: nullable(
          pick(row, ["product-size-tier", "size-tier"]),
        ),
        storageFeeCentavos,
        dangerousGoodsStorageType: nullable(
          pick(row, ["dangerous-goods-storage-type"]),
        ),
        payload: row,
      };
    })
    .filter((row) => row.asin || row.fnSku);
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
