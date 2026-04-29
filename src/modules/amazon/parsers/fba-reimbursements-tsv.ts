import {
  compactKey,
  parseCentavos,
  parseDateOrNull,
  parseIntValue,
  parseTsvRecords,
  pick,
  type TsvRecord,
} from "@/modules/amazon/parsers/report-utils";

export interface FbaReimbursementRow {
  naturalKey: string;
  reimbursementId: string | null;
  caseId: string | null;
  amazonOrderId: string | null;
  approvalDate: Date | null;
  sku: string | null;
  fnSku: string | null;
  asin: string | null;
  productName: string | null;
  reason: string | null;
  condition: string | null;
  currency: string | null;
  amountPerUnitCentavos: number | null;
  amountTotalCentavos: number;
  quantityCash: number;
  quantityInventory: number;
  quantityTotal: number;
  originalReimbursementId: string | null;
  originalReimbursementType: string | null;
  payload: TsvRecord;
}

export function parseFbaReimbursementsTsv(
  input: Buffer | string,
): FbaReimbursementRow[] {
  return parseTsvRecords(input)
    .map((row) => {
      const reimbursementId = nullable(
        pick(row, ["reimbursement-id", "reimbursement id"]),
      );
      const caseId = nullable(pick(row, ["case-id", "case id"]));
      const amazonOrderId = nullable(
        pick(row, ["amazon-order-id", "order-id", "order id"]),
      );
      const approvalDate = parseDateOrNull(
        pick(row, ["approval-date", "approved-date", "date"]),
      );
      const sku = nullable(pick(row, ["sku", "merchant-sku", "seller-sku"]));
      const fnSku = nullable(pick(row, ["fnsku", "fn-sku"]));
      const asin = nullable(pick(row, ["asin"]));
      const reason = nullable(pick(row, ["reason", "reason-code"]));
      const quantityCash = parseIntValue(
        pick(row, ["quantity-reimbursed-cash", "quantity-cash"]),
      );
      const quantityInventory = parseIntValue(
        pick(row, ["quantity-reimbursed-inventory", "quantity-inventory"]),
      );
      const quantityTotal =
        parseIntValue(
          pick(row, ["quantity-reimbursed-total", "quantity-total", "quantity"]),
        ) ||
        quantityCash + quantityInventory;
      const amountTotalCentavos = parseCentavos(
        pick(row, ["amount-total", "total-amount", "reimbursement-amount"]),
      );

      const naturalKey = compactKey([
        reimbursementId,
        caseId,
        amazonOrderId,
        sku,
        fnSku,
        approvalDate,
        amountTotalCentavos,
        quantityTotal,
      ]);

      return {
        naturalKey,
        reimbursementId,
        caseId,
        amazonOrderId,
        approvalDate,
        sku,
        fnSku,
        asin,
        productName: nullable(pick(row, ["product-name", "title"])),
        reason,
        condition: nullable(pick(row, ["condition"])),
        currency: nullable(
          pick(row, ["currency-unit", "currency-code", "currency"]),
        ),
        amountPerUnitCentavos: centsOrNull(
          pick(row, ["amount-per-unit", "amount/unit"]),
        ),
        amountTotalCentavos,
        quantityCash,
        quantityInventory,
        quantityTotal,
        originalReimbursementId: nullable(
          pick(row, ["original-reimbursement-id"]),
        ),
        originalReimbursementType: nullable(
          pick(row, ["original-reimbursement-type"]),
        ),
        payload: row,
      };
    })
    .filter((row) => row.sku || row.fnSku || row.asin || row.reimbursementId);
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function centsOrNull(value: string): number | null {
  if (!value.trim()) return null;
  return parseCentavos(value);
}
