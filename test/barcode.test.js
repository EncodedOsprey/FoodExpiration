import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gs1DateToISO, isValidGTIN, lookupCandidates, normalizeScan, upcEtoUpcA } from '../app/js/barcode.js';

test('validates GTIN check digits', () => {
  assert.equal(isValidGTIN('4006381333931'), true);
  assert.equal(isValidGTIN('4006381333932'), false);
  assert.equal(isValidGTIN('036000291452'), true);
});

test('expands UPC-E and tries UPC-A/EAN-13 variants', () => {
  assert.equal(upcEtoUpcA('04252614'), '042100005264');
  assert.deepEqual(normalizeScan('04252614', 'upc_e'), { code: '042100005264', expiry: null });
  assert.deepEqual(lookupCandidates('036000291452'), ['036000291452', '0036000291452']);
  assert.deepEqual(lookupCandidates('0036000291452'), ['0036000291452', '036000291452']);
});

test('reads the product and expiry date from GS1 barcodes', () => {
  assert.deepEqual(normalizeScan('(01)09506000134352(17)261124(10)ABC123', 'qr_code'), {
    code: '9506000134352',
    expiry: '2026-11-24',
  });
  assert.deepEqual(normalizeScan('01095060001343521726112410ABC123', 'databar_expanded'), {
    code: '9506000134352',
    expiry: '2026-11-24',
  });
  // Variable-length lot number (AI 10) ends at a GS separator, then the expiry follows.
  assert.deepEqual(normalizeScan('010950600013435210LOT7\u001d17261124', 'code_128'), {
    code: '9506000134352',
    expiry: '2026-11-24',
  });
  assert.equal(gs1DateToISO('260200'), '2026-02-28');
});

test('leaves ordinary codes alone', () => {
  assert.deepEqual(normalizeScan(' 4006381333931 ', 'ean_13'), { code: '4006381333931', expiry: null });
  // A Code 128 that merely starts with "01" is not GS1 unless the GTIN is valid.
  assert.equal(normalizeScan('0112345678901299', 'code_128').expiry, null);
});
