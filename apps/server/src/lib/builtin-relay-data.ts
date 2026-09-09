// ============================================================
// 内置公益中转站配置密文（AES-256-GCM：iv(12B) | authTag(16B) | data）
// 明文不出现在任何源码/文档中；解封逻辑见 builtin-relay.ts。
// 密钥分层：RELAY_KEY_PART_A（本文件）⊕ builtin-relay-seal.ts 的
// RELAY_KEY_PART_B → SHA-256 → AES-256 密钥，单一文件无法还原内容。
// ============================================================

export const RELAY_CIPHERTEXT = '45vlfNaEsH5y2gwxt+T8vs4zPpn4zXkU1Iwp1tiyoHr80IouWhdsmTnZ20XBJ9sgSbe6Sz+mZWf5W2dwM4D7/KqMTKb0hkN6KZvGpDpMptgoqw+cN5CoMabYR2oVcoH1B8ovjULh5dK3q+rbTVGYP40K66aTGCWVdM5VZPl7/H2MQuHhgJJXL4nQVLyxW8nBWIIVHTFLstW6/7vQVeyAhZWkDvU9Ms75+63niVnc61is3C18zLdwv+aUBQGuryBuyqKxQ9Nj3vvwtDz/RstDvn69';

export const RELAY_KEY_PART_A = 'f65ca9d109c96900391ff2f924e8fee70f19faa5f9ab052fadcbe30bcf6866a2';
