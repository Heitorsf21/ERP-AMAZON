import {
  compactKey,
  parseDateOrNull,
  parseIntValue,
  parseTsvRecords,
  pick,
  type TsvRecord,
} from "@/modules/amazon/parsers/report-utils";

export interface FbaReturnRow {
  naturalKey: string;
  tipoReport: "FBA";
  returnDate: Date | null;
  amazonOrderId: string | null;
  sku: string | null;
  fnSku: string | null;
  asin: string | null;
  productName: string | null;
  quantity: number;
  fulfillmentCenterId: string | null;
  detailedDisposition: string | null;
  reason: string | null;
  status: string | null;
  licensePlateNumber: string | null;
  customerComments: string | null;
  payload: TsvRecord;
}

export function parseFbaReturnsTsv(input: Buffer | string): FbaReturnRow[] {
  return parseTsvRecords(input)
    .map((row) => {
      const returnDate = parseDateOrNull(
        pick(row, ["return-date", "date", "returned-date"]),
      );
      const amazonOrderId = nullable(
        pick(row, ["order-id", "amazon-order-id", "amazon order id"]),
      );
      const sku = nullable(pick(row, ["sku", "merchant-sku", "seller-sku"]));
      const fnSku = nullable(pick(row, ["fnsku", "fn-sku"]));
      const asin = nullable(pick(row, ["asin"]));
      const quantity = parseIntValue(pick(row, ["quantity", "qty"])) || 1;
      const licensePlateNumber = nullable(
        pick(row, ["license-plate-number", "lpn"]),
      );

      return {
        naturalKey: compactKey([
          "FBA",
          amazonOrderId,
          sku,
          fnSku,
          licensePlateNumber,
          returnDate,
          quantity,
        ]),
        tipoReport: "FBA" as const,
        returnDate,
        amazonOrderId,
        sku,
        fnSku,
        asin,
        productName: nullable(pick(row, ["product-name", "title"])),
        quantity,
        fulfillmentCenterId: nullable(
          pick(row, ["fulfillment-center-id", "fulfillment-center"]),
        ),
        detailedDisposition: nullable(
          pick(row, ["detailed-disposition", "disposition"]),
        ),
        reason: nullable(pick(row, ["reason", "return-reason"])),
        status: nullable(pick(row, ["status", "return-status"])),
        licensePlateNumber,
        customerComments: nullable(
          pick(row, ["customer-comments", "customer-comment", "comments"]),
        ),
        payload: row,
      };
    })
    .filter((row) => row.amazonOrderId || row.sku || row.fnSku || row.asin);
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
