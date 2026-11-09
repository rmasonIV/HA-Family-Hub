# Reduced Family Hub fork

This draft starts from upstream commit `eefa1da5a29ad0baf1b667e0bbfd3585ad721ff8`. It keeps the family dashboard while excluding features that are not needed for this household's first installation. It is not deployed or ready to merge until isolated Home Assistant/browser checks pass.

## Scope

Retained: calendar display, regular calendar editing subject to Home Assistant entity permissions and Family Hub permissions, ordinary manual meal-plan entries and recipe links, local to-do lists, chores/rewards/routines/goals, timers, themes, and the screensaver. These are household-wide features; a per-person filter is not a confidentiality boundary.

Excluded at the backend: Grocy/pantry, built-in Recipe Box and recipe import, catalog suggestions, external Amazon/GoWish synchronization, Companion screens, uploaded ZIP installation, and Quick Add/Assist shortcuts. Quick Add is excluded because it needs caller-context and permission work before it can be safely restored. The main calendar still handles ordinary manual meal-plan entries.

The command handlers for 54 excluded operations are replaced before their original coroutine is scheduled. Compatibility reads return empty/unconfigured results; mutations return `feature_disabled`. No dashboard setting can enable those original handlers. Grocy transports also reject use, its synchronization returns before touching HA or the network, and the corresponding background jobs are not scheduled. External wishlist synchronization is a no-op and its commands are not registered. Companion and Quick Add commands/services are not registered. Both direct options-flow steps and the ZIP installer itself reject uploaded code installation.

Excluded standalone cards are inert messages. The calendar ignores legacy Recipe Box caches and has escaped, text-only compatibility rendering instead of raw recipe HTML. Its excluded controls are suppressed as presentation in addition to the separate backend protections. Dormant upstream helper code remains to make later review/rebasing possible; it must not be reenabled without revisiting the audit.

Mealie is **not integrated by this change**. Existing Mealie services are unaffected. A later change can add a narrow server-side adapter for Mealie meal-plan/recipe reads; credentials should stay in private integration options, with destination validation and explicit permissions. No Mealie URL or credential is requested or embedded here.

## Shared hardening

- Actual HA administrators are required for global settings, theme changes, notification-routing configuration, backup creation, and other household configuration endpoints.
- Direct calendar mutation requires HA control permission on the target calendar. Creation additionally requires Family Hub's edit-event permission; edit/delete retain their existing Family Hub checks.
- Privacy mode can be enabled by any signed-in account. Turning it off requires permission or the checked PIN path. Privacy switch service calls apply the same permission to authenticated users; automation calls with no user context retain authority.
- New device records belong to the registering account. Other accounts cannot overwrite them, read pending settings, or receive their targeted push events. Limits are 32 devices and 16 instances per device, with IDs capped at 128 characters. Legacy devices without ownership require an admin to adopt them; back up device settings first.
- Settings payloads are capped at 512 KiB. Kiosk elevation tokens are bound to the originating authenticated WebSocket connection in addition to their existing expiration.
- Setup and unload use the same seven-platform list. Failed unload preserves runtime state.
- Automatic migration that rewrites saved dashboards is not scheduled. Existing dashboard layouts should be deliberately edited by the operator.
- Automatic Google Fonts requests are removed; local accessibility/system fonts remain. Explicit external images/video and user-configured HA cloud notification services can still make external requests. This is not a network-isolation guarantee.
- Only `card/` and `panel/` are canonical frontend sources. Stale root JS, the calendar backup, and bytecode artifacts are excluded from this working tree. Disabled standalone card files are retained as inert compatibility messages.
- Documentation deployment is manual-only and the unused external CMS is removed. Website dependency upgrades and action SHA pinning are deferred; the website is not part of HA's Python installation and should remain unpublished/unbuilt for this phase.

The fork uses manifest version `2026.11.1.1` and a conservative HACS minimum of HA `2026.11.0`, matching the API generation inspected during development. This is a compatibility floor for this draft, **not evidence of a full HA compatibility test**. Check the actual installed HA version before choosing a target; do not upgrade a working system just to install this draft.

## Verification performed

Run from the repository root:

```sh
python3 -B -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/reduced-profile.test.cjs
```

The Python tests extract selected definitions into isolated stubs; they do not import/start the integration or contact HA. They cover all 54 excluded dispatchers for admin/non-admin users, settings tampering/limits, calendar denial and permitted creation, privacy denial/enabling, blocked ZIP installation, disabled network synchronization, device limits/ownership, and failed unload behavior. JavaScript tests cover hostile step text, legacy cache avoidance, excluded menu entries, and inert standalone cards. All Python sources and shipped JavaScript are also checked for syntax.

These checks do not replace a real HA/browser test. The upstream jsdom layout suite was not run; its dependency is not installed by this change. No HA instance, Pi, HACS installation, real account, or live calendar was used during development.

## Required before merge/deployment

1. Use an isolated HA instance with dummy calendars, a synthetic meal-plan list, separate admin/non-admin test accounts, and no real cloud or Grocy/Mealie credentials.
2. Check the actual HA decorators/schemas, setup/options flow, and every retained card in Chromium. Confirm calendar display, allowed/denied editing, manual meals, local lists, chores, timers, themes, and screensaver operation.
3. Verify excluded features cannot run through direct WebSocket requests or options-flow steps, and no external wishlist/recipe/Grocy request or font request occurs. Inspect browser requests as well as HA logs.
4. Exercise settings saves as both roles, locked-popup rules, privacy unlocking via both switches and WebSocket, device enrollment/ownership, and repeated reload/unload. Confirm failed unload does not discard state.
5. Measure HA responsiveness, Chromium memory/CPU, and idle/view-switch behavior. Use simple themes and no cameras/video first.
6. Review the exact release source and prepare a tested backup/rollback. Only then choose a release of **rmasonIV's fork** through HACS, restart HA, and add a separate dashboard.

This draft does not change or upgrade the user's working Home Assistant installation. Future upstream changes should be reviewed; an automatic merge can restore excluded behavior.
