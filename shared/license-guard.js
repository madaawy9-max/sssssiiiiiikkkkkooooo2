'use strict';
/* ---------------------------------------------------------------------------
 * SIKO DEV — FiveM License Guard
 * ---------------------------------------------------------------------------
 * Generates a Lua snippet that locks a protected resource to ONE server.
 *
 * Identity used (server-side only, never trust the client):
 *   - sv_licenseKey: FiveM's own per-server Cfx.re license key. This is the
 *     closest thing FiveM has to a real "hardware id" — it's tied to the
 *     server owner's Cfx.re account and isn't something you can change by
 *     editing a convar on a whim (changing it de-registers the server from
 *     Cfx.re's server list).
 *   - The caller's IP is NOT read from anything the client/server sends in
 *     the request body. It's read by YOUR license API from the incoming
 *     HTTP connection itself (req.socket.remoteAddress / X-Forwarded-For
 *     behind a trusted proxy only). That's the only way an IP check means
 *     anything — a self-reported IP is trivial to fake.
 *
 * Flow:
 *   1. On resource start, and every CHECK_INTERVAL after that, the server
 *      calls {baseUrl}/api/license/{licenseCode}/verify with its
 *      sv_licenseKey in the body.
 *   2. Your API (you implement this part server-side, see README) looks up
 *      licenseCode:
 *        - Not bound yet -> bind it to (licenseKey, callerIp) now, return OK.
 *        - Bound, and licenseKey+ip both match -> return OK.
 *        - Bound, but licenseKey or ip differs -> return DENY.
 *   3. DENY (or repeated network failure past the grace period) stops the
 *      resource. It does not touch the user's files, database, or anything
 *      else on their box — it just refuses to keep running. Don't build in
 *      destructive "punish the pirate" behavior; that crosses from DRM into
 *      sabotage and it's also the kind of thing that gets a hosting account
 *      terminated for ToS violations.
 * ------------------------------------------------------------------------- */

function buildLicenseGuard({
  resourceName,
  licenseCode,
  baseUrl,
  brand = 'SIKO DEV',
  checkIntervalMs = 10 * 60 * 1000, // re-check every 10 minutes while running
  failClosedAfter = 3,              // stop after this many consecutive failed checks
}) {
  if (!resourceName || !licenseCode || !baseUrl) {
    throw new Error('buildLicenseGuard requires resourceName, licenseCode, baseUrl');
  }

  return `-- [${brand}] License Guard — fused into the protected blob. Removing this
-- block breaks the surrounding integrity checks, it does not disable them.
do
    if not IsDuplicityVersion or not IsDuplicityVersion() then
        -- This guard only makes sense server-side. If somehow loaded
        -- client-side, do nothing rather than error out noisily.
        goto ${brand.replace(/\\s+/g, '_')}_guard_done
    end

    local _lic_code   = "${licenseCode}"
    local _lic_base   = "${baseUrl}"
    local _lic_res    = "${resourceName}"
    local _lic_fail_n = 0
    local _lic_max_fail = ${failClosedAfter}

    local function _lic_stop(reason)
        print(("[${brand}] License check failed for '%s': %s"):format(_lic_res, tostring(reason)))
        print(("[${brand}] Stopping resource '%s'."):format(_lic_res))
        -- Fail-closed: refuse to keep running. No destructive side effects.
        Citizen.CreateThread(function()
            Wait(0)
            StopResource(_lic_res)
        end)
    end

    local function _lic_check(onResult)
        local svKey = GetConvar and GetConvar('sv_licenseKey', '') or ''
        local payload = json.encode({
            licenseKey = svKey,
            resource   = _lic_res,
        })
        PerformHttpRequest(
            _lic_base .. "/api/license/" .. _lic_code .. "/verify",
            function(statusCode, body, headers)
                if statusCode == 200 then
                    local ok = false
                    local decoded = body and json.decode(body) or nil
                    if decoded and decoded.status == "ok" then ok = true end
                    onResult(ok, decoded and decoded.reason or ("http " .. tostring(statusCode)))
                else
                    onResult(false, "http " .. tostring(statusCode))
                end
            end,
            "POST",
            payload,
            { ["Content-Type"] = "application/json" }
        )
    end

    local function _lic_cycle()
        _lic_check(function(ok, reason)
            if ok then
                _lic_fail_n = 0
            else
                _lic_fail_n = _lic_fail_n + 1
                print(("[${brand}] License check attempt %d/%d failed: %s")
                    :format(_lic_fail_n, _lic_max_fail, tostring(reason)))
                if _lic_fail_n >= _lic_max_fail then
                    _lic_stop(reason)
                end
            end
        end)
    end

    Citizen.CreateThread(function()
        _lic_cycle()
        while true do
            Wait(${checkIntervalMs})
            _lic_cycle()
        end
    end)

    ::${brand.replace(/\s+/g, '_')}_guard_done::
end

`;
}

module.exports = { buildLicenseGuard };
