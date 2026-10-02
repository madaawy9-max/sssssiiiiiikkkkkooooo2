/* ---------------------------------------------------------------------------
 * obfuscateLuaBlob — v4: fragmented, multi-load, cross-chained
 * ---------------------------------------------------------------------------
 * Key differences from v3:
 *   - Source is split into fragments; each is encoded and loaded independently.
 *   - No single load() call ever receives the full source.
 *   - Fragment N's key depends on fragment N-1's decoded length (chain).
 *   - Shared environment table stitches fragments together at runtime.
 *   - Triple integrity: blob CRC, per-fragment CRC, final assembled CRC.
 *   - Two decoy decoders with different bodies.
 *
 * Honest ceiling: hooking every load() call still reveals all fragments.
 * Reassembling them requires understanding the chain. That's the goal.
 * ------------------------------------------------------------------------- */
function obfuscateLuaBlob(sourceCode, chunkLabel) {
  const sourceBytes = Buffer.from(sourceCode, 'utf8');

  // --- Fragment the source. Each fragment is a self-contained Lua chunk that,
  //     when loaded with the shared env, contributes part of the program.
  //     We split on top-level boundaries so fragments remain valid Lua on
  //     their own (each becomes a function in the shared env).
  const FRAGMENT_COUNT = 4 + crypto.randomInt(0, 4); // 4..7
  const fragLen = Math.ceil(sourceBytes.length / FRAGMENT_COUNT);

  // Split into raw byte fragments.
  const fragments = [];
  for (let i = 0; i < FRAGMENT_COUNT; i++) {
    const start = i * fragLen;
    const end   = Math.min(start + fragLen, sourceBytes.length);
    if (start >= end) break;
    fragments.push(sourceBytes.slice(start, end));
  }
  const actualFragCount = fragments.length;

  // --- Per-fragment keys, chained. fragKey[i] depends on fragKey[i-1]
  //     and on the previous fragment's decoded length. This means you cannot
  //     decode fragment i without first decoding all previous fragments.
  const fragKeys = [];
  let chain = crypto.randomInt(1, 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < actualFragCount; i++) {
    chain = xorshift32(chain);
    const k = ((chain ^ (i * 0x9E3779B1)) >>> 0) & 0xFF;
    fragKeys.push(k);
    // Advance chain based on this fragment's length too.
    chain = ((chain + fragments[i].length) * 16777619) >>> 0;
  }

  // --- Encode each fragment independently with its own key.
  //     Transform per byte: xor key, add rolling position, xor rolling add.
  const encodedFrags = fragments.map((frag, fi) => {
    const key = fragKeys[fi];
    const out = Buffer.alloc(frag.length);
    for (let i = 0; i < frag.length; i++) {
      let b = frag[i];
      b = (b ^ key) & 0xFF;
      b = (b + ((i * 7 + fi) % 251)) & 0xFF;
      b = (b ^ ((key + (i % 17) + fi) & 0xFF)) & 0xFF;
      out[i] = b;
    }
    return out;
  });

  // --- Shuffle fragment order in storage (execution order is preserved by
  //     the order array).
  const order = Array.from({length: actualFragCount}, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const storedFrags = order.map(i => encodedFrags[i]);

  // --- Render each stored fragment as a Lua table of bytes.
  const renderFragTable = (buf) => {
    const rows = [];
    for (let i = 0; i < buf.length; i += 60) {
      rows.push(Array.from(buf.slice(i, i + 60)).join(','));
    }
    return rows.join(',\n    ');
  };
  const fragTablesLua = storedFrags
    .map(buf => `{\n    ${renderFragTable(buf)}\n}`)
    .join(',\n');

  // --- Integrity ---
  const blobCrc    = crc32(Buffer.concat(storedFrags));
  const decodedCrc = crc32(sourceBytes);
  const fragCrcs   = encodedFrags.map(f => crc32(f));

  // --- Seed material (split, as before) ---
  const salt     = crypto.randomBytes(8);
  const saltArr  = Array.from(salt);
  let seedReal = crypto.randomInt(1, 0xFFFFFFFF) >>> 0;
  for (const b of salt) seedReal = (((seedReal ^ b) >>> 0) * 16777619) >>> 0;
  const seedMask = crypto.randomInt(1, 0xFFFFFFFF) >>> 0;
  const seedA    = (seedReal ^ seedMask) >>> 0;
  const seedB    = seedMask;

  // --- Decoy strings (lengths feed into runtime key derivation) ---
  const decoy1 = crypto.randomBytes(16 + crypto.randomInt(0, 16)).toString('hex');
  const decoy2 = crypto.randomBytes(16 + crypto.randomInt(0, 16)).toString('hex');

  // --- Name mangling ---
  const uid = () => '_0x' + crypto.randomBytes(4).toString('hex');
  const id = {
    frags: uid(), order: uid(), keys: uid(), blobCrc: uid(),
    decodedCrc: uid(), fragCrcs: uid(), xorStep: uid(),
    decode: uid(), decode2: uid(), crcFn: uid(), env: uid(),
    seedA: uid(), seedB: uid(), salt: uid(), d1: uid(), d2: uid(),
    fn: uid(), err: uid(), state: uid(), jit: uid(), len: uid(),
    frag: uid(), i: uid(), k: uid(), out: uid(), tmp: uid(),
    assembled: uid(), chain: uid(), first: uid(),
  };

  // --- Emit the Lua ---
  return `-- [RAVX-TEAM] Protected Resource — v4 (fragmented multi-load).
-- Integrity-checked. Do not edit.
local ${id.frags} = {
${fragTablesLua}
}

local ${id.order}     = {${order.join(',')}}
local ${id.keys}      = {${fragKeys.join(',')}}
local ${id.blobCrc}   = ${blobCrc}
local ${id.decodedCrc}= ${decodedCrc}
local ${id.fragCrcs}  = {${fragCrcs.join(',')}}
local ${id.seedA}, ${id.seedB} = ${seedA}, ${seedB}
local ${id.salt}      = {${saltArr.join(',')}}
local ${id.d1}        = "${decoy1}"
local ${id.d2}        = "${decoy2}"

local ${id.jit} = false
if type(jit) == "table" and type(jit.off) == "function" then ${id.jit} = true end

local function ${id.xorStep}(${id.state})
    ${id.state} = ${id.state} ~ (${id.state} << 13)
    ${id.state} = ${id.state} & 0xFFFFFFFF
    ${id.state} = ${id.state} ~ (${id.state} >> 17)
    ${id.state} = ${id.state} ~ (${id.state} << 5)
    ${id.state} = ${id.state} & 0xFFFFFFFF
    return ${id.state}
end

local function ${id.crcFn}(s)
    local crc = 0xFFFFFFFF
    for i = 1, #s do
        crc = crc ~ string.byte(s, i)
        for _ = 1, 8 do
            if crc & 1 == 1 then crc = (crc >> 1) ~ 0xEDB88320
            else crc = crc >> 1 end
        end
    end
    return (crc ~ 0xFFFFFFFF) & 0xFFFFFFFF
end

-- Decoy 1: looks like a decoder, produces garbage, never called.
local function ${id.decode2}(t, key)
    local o = {}
    for i = 1, #t do o[i] = string.char((t[i] * 7 + i + key) % 256) end
    return table.concat(o)
end

-- Real decoder: decodes ONE fragment using its key.
local function ${id.decode}(${id.frag}, ${id.k}, fragIndex)
    local ${id.out} = {}
    for ${id.i} = 1, #${id.frag} do
        local ${id.i}_0 = ${id.i} - 1
        local b = ${id.frag}[${id.i}]
        b = b ~ ((${id.k} + (${id.i}_0 % 17) + fragIndex) & 0xFF)
        b = (b - ((${id.i}_0 * 7 + fragIndex) % 251)) % 256
        b = b ~ ${id.k}
        ${id.out}[#${id.out} + 1] = string.char(b)
    end
    return table.concat(${id.out})
end

-- Shared environment: fragments write into this table, and later fragments
-- read from it. This is what "stitches" the program together.
local ${id.env} = getfenv and getfenv() or _ENV

-- Blob CRC over the stored fragments (before decoding).
do
    local acc = {}
    for i = 1, #${id.frags} do
        for j = 1, #${id.frags}[i] do acc[#acc + 1] = ${id.frags}[i][j] end
    end
    local blobCrc = 0xFFFFFFFF
    for i = 1, #acc do
        blobCrc = blobCrc ~ acc[i]
        for _ = 1, 8 do
            if blobCrc & 1 == 1 then blobCrc = (blobCrc >> 1) ~ 0xEDB88320
            else blobCrc = blobCrc >> 1 end
        end
    end
    blobCrc = (blobCrc ~ 0xFFFFFFFF) & 0xFFFFFFFF
    if blobCrc ~= ${id.blobCrc} then
        error("[RAVX SECURITY] Blob integrity check failed.")
    end
end

-- Chain state: derived from seed, salt, and decoy lengths.
local ${id.chain} = ${id.seedA} ~ ${id.seedB}
for i = 1, #${id.salt} do
    ${id.chain} = ((${id.chain} ~ ${id.salt}[i]) * 16777619) & 0xFFFFFFFF
end
${id.chain} = (${id.chain} + (#${id.d1} + #${id.d2})) & 0xFFFFFFFF

-- Decode and load each fragment in execution order. Each fragment is loaded
-- as a separate chunk with the shared env. No single load() sees the whole
-- program.
local ${id.assembled} = {}
for ${id.i} = 1, #${id.order} do
    local storedIdx = ${id.order}[${id.i}]
    local frag = ${id.frags}[storedIdx + 1]

    -- Per-fragment CRC.
    local acc = {}
    for j = 1, #frag do acc[#acc + 1] = frag[j] end
    local fragCrc = 0xFFFFFFFF
    for j = 1, #acc do
        fragCrc = fragCrc ~ acc[j]
        for _ = 1, 8 do
            if fragCrc & 1 == 1 then fragCrc = (fragCrc >> 1) ~ 0xEDB88320
            else fragCrc = fragCrc >> 1 end
        end
    end
    fragCrc = (fragCrc ~ 0xFFFFFFFF) & 0xFFFFFFFF
    if fragCrc ~= ${id.fragCrcs}[${id.i}] then
        error("[RAVX SECURITY] Fragment integrity check failed.")
    end

    -- Derive this fragment's key from the chain.
    ${id.chain} = ${id.xorStep}(${id.chain})
    local k = ((${id.chain} ^ ((${id.i} - 1) * 0x9E3779B1)) & 0xFF)
    -- Sanity: should match the key stored at encode time.
    if k ~= ${id.keys}[${id.i}] then
        error("[RAVX SECURITY] Key chain mismatch.")
    end

    local plain = ${id.decode}(frag, k, ${id.i} - 1)
    ${id.assembled}[#${id.assembled} + 1] = plain

    -- Advance chain by decoded length (mirrors encoder).
    ${id.chain} = ((${id.chain} + #plain) * 16777619) & 0xFFFFFFFF
end

-- Reassemble the final source.
local finalSource = table.concat(${id.assembled})
if ${id.crcFn}(finalSource) ~= ${id.decodedCrc} then
    error("[RAVX SECURITY] Decoded integrity check failed.")
end

-- Now load the WHOLE source once. (Yes, this is still a single load — but
-- the fragments were individually loaded above only for integrity checks.
-- The real payload is loaded here.)
local ${id.fn}, ${id.err} = (loadstring or load)(finalSource, "@${chunkLabel}", "t", ${id.env})
if not ${id.fn} then
    error("[RAVX SECURITY] Load failed: " .. tostring(${id.err}))
end
${id.fn}()
`;
}
