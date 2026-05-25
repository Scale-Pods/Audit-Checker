# Audit Checker — ZV Steels

A tool that helps verify purchase and sales documents are correct and match each other. Instead of manually comparing papers, you upload them and the system checks everything automatically.

---

## Purchase Audit

Use this when goods arrive at your warehouse and you need to verify the supplier's documents.

### What you upload

**Invoice** — The bill from the supplier. Contains the invoice number, date, supplier name, GSTIN, amount, weight, product details, HSN code, and your billing/shipping address.

**E-Way Bill** — The transport permit issued for moving the goods. Contains the e-way bill number, vehicle number, supplier and recipient details, weight, and amount.

**LR Copy (Lorry Receipt)** — The receipt from the truck driver / transport company. Contains the LR number, vehicle number, weight, and delivery details.

**GRN (Goods Received Note)** — The warehouse receipt generated when goods are received. Contains the batch/coil numbers, quantity received, and receiving date.

### How the check works

The system lines up all four documents side by side and compares every field.

**Invoice Number** — The unique number on the supplier's bill. It should appear on the Invoice, E-Way Bill, LR, and GRN. If the numbers don't match, the documents might belong to different shipments.

**Date** — The date of the transaction. Checked across all documents. Formats like "24-May-26", "24/05/2026", and "24-May-2026" are all treated as the same date automatically.

**Supplier Name** — The company you bought from. Checked for common variations like "Pvt" vs "Private" or "Ltd" vs "Limited".

**GSTIN** — The supplier's GST number. This must match exactly across all documents. A mismatch here is treated as critical — it's a tax compliance issue.

**Amount** — The total value in rupees. Checked across Invoice, E-Way Bill, and GRN. Even a ₹1 difference is flagged.

**Weight / Quantity** — The weight of the goods (in MT or KG). Compared across Invoice, E-Way Bill, and LR. The system allows a small tolerance for weighing differences but flags anything beyond that.

**Vehicle Number** — The truck number. Checked on the E-Way Bill and LR. If they don't match, the wrong truck might have delivered the goods.

**HSN Code** — The product classification code (used for GST). The first 4 to 6 digits are compared. Small differences in the later digits suggest a sub-classification issue.

**Product / Description** — What was bought. Checked for partial matches — one document might say "MS Angle" while another says "Mild Steel Angle". The system spots that these are the same thing.

**Batch / Coil Number** — The production batch or coil number from the supplier. Appears on the Invoice and GRN. Must match to confirm the correct material was received.

**Bill To Address** — The billing address. Checked against ZV Steels' known office locations (Mumbai, Masjid Bunder, Carnac Bunder).

**Ship To Address** — The delivery address. Checked against known delivery locations (Taloja, MIDC, Roshan Fabricators).

**E-Way Bill Number** — The transport permit number. Should be present on the E-Way Bill document.

**LR Number** — The lorry receipt number. Should be present on the LR copy.

---

## Sales Audit

Use this when you've issued an invoice to a customer and need to verify it matches your internal records.

### What you upload

**Sales Invoice** — The invoice you raised for your customer. Contains the order number, party order number, customer name, broker name, rate, quantity, payment terms, thickness, width, and length.

**Sheet** — Your internal record for the same sale (from your system or spreadsheet). Contains the same fields for comparison.

### How the check works

The system compares the Sales Invoice against the Sheet field by field.

**Order Number** — Your internal order number. Should match between the Invoice and the Sheet.

**Party Order Number** — The customer's own order or reference number. Should match.

**Broker Name** — The name of the broker involved. Checked for spelling mistakes and variations (e.g., "Rajesh" vs "Rajes").

**Bill To Name** — The customer's name. Checked for spelling variations and common abbreviations.

**Rate** — The price per unit. Compared as a number — must be the same on both documents.

**Quantity (MT)** — The quantity in metric tons. A small tolerance is allowed (up to 250 KG difference) to account for rounding.

**Payment Terms** — The payment terms (e.g., "150 Days"). The numeric part is extracted and compared.

**Thickness, Width, Length** — The product dimensions. Compared as numbers — must be the same.

---

## Understanding the results

Every field gets one of these statuses:

**Match (green)** — All documents agree. No action needed.

**Partial Match (yellow)** — Small differences that are likely just formatting or OCR issues. Worth a glance but probably fine.

**Mismatch (red)** — Real differences. Needs someone to check which document has the correct value.

**Critical (red, bold)** — GSTIN mismatch. Tax compliance issue — needs immediate attention.

---

## The two views of results

**Intelligence View** — A quick summary. Shows an overall score out of 100%, a pass/fail status for each key field, and a list of issues found.

**Raw Data View** — A full table. Every field from every document is visible in its own cell. Green shading means that field matches across all documents. Red means something differs. Hover over any field to see why it was flagged.

---

## Making a decision

After reviewing the results, you can **Approve** or **Reject** the audit. This records your decision so everyone knows the record has been reviewed.

---

## Other pages

**Dashboard** — The home screen. Shows how many audits passed, how many had issues, and a list of recent records. Click any record to see full details.

**History** — All past purchase and sales audits in one place. Search by invoice number to find a specific record.

**Analytics** — See trends over time — which fields have the most errors, how mismatch rates are changing, and overall performance.
