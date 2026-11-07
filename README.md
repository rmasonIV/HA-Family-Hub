> **Reduced fork — draft, not deployed.** See [REDUCED_PROFILE.md](REDUCED_PROFILE.md) for the actual supported features, security changes, tests, and deployment prerequisites. Grocy, the built-in Recipe Box/imports, external wishlists, Companion, Quick Add, and uploaded ZIP updates are disabled. The upstream documentation below includes features excluded from this fork. Mealie integration is planned separately.

<h1 align="center">Family Hub</h1>

<p align="center">
<a href="https://github.com/JVarhol/HA-Family-Hub/releases/latest"><img src="https://img.shields.io/github/v/release/JVarhol/HA-Family-Hub?style=for-the-badge&color=5da3a6" alt="Release"></a>
<a href="https://github.com/JVarhol/HA-Family-Hub/issues"><img src="https://img.shields.io/github/issues/JVarhol/HA-Family-Hub?style=for-the-badge&color=e8604c" alt="Issues"></a>
<a href="https://github.com/JVarhol/HA-Family-Hub/blob/main/LICENSE"><img src="https://img.shields.io/github/license/JVarhol/HA-Family-Hub?style=for-the-badge&color=3fbf5f" alt="License"></a>
<a href="https://github.com/hacs/integration"><img src="https://img.shields.io/badge/HACS-Custom-41BDF5?style=for-the-badge&logo=homeassistantcommunitystore&logoColor=white" alt="HACS Custom Repository"></a>
</p>

<p align="center">
  A whole family-tablet dashboard for Home Assistant: calendar, meal planning,<br />
  chores, rewards, timers and more, in one install.<br />
  Runs entirely on your own Home Assistant, no cloud or subscription.
</p>

<p align="center">
  <a href="#installation">Installation</a> · <a href="#a-look-around">Screenshots</a> · <a href="#features">Features</a> · <a href="#themes">Themes</a> · <a href="https://jvarhol.github.io/HA-Family-Hub/">Documentation</a> · <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/JVarhol/HA-Family-Hub/main/images/readme/hero-liquid-glass.webp" alt="The Family Week Calendar card in the Liquid Glass theme: a week of family events in colour-coded columns, with meals planned at the top of each day" width="100%" />
</p>

## A look around

### The family calendar

A week of everyone's calendars side by side, with breakfast, lunch and dinner planned at the top of each day. Switch between Week, Month, Planner and Agenda layouts, and tap any event to see details, edit it, duplicate it or turn it into a countdown.

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/JVarhol/HA-Family-Hub/main/images/readme/view-month.webp" alt="Month view in the HA Light theme" /><br /><sub><b>Month</b> (HA Light theme)</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/JVarhol/HA-Family-Hub/main/images/readme/view-planner.webp" alt="Planner view: one row per day, one column per person" /><br /><sub><b>Planner</b>: one row per day, one column per person</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/JVarhol/HA-Family-Hub/main/images/readme/view-agenda.webp" alt="Agenda view in the Liquid Glass Dark theme" /><br /><sub><b>Agenda</b>: a simple list, great for a narrow screen (Liquid Glass Dark)</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/JVarhol/HA-Family-Hub/main/images/readme/view-event.webp" alt="An event pop-up with reminders, a checklist and meal options" /><br /><sub><b>Event details</b>: reminders, checklists, edit and duplicate (Midnight)</sub></td>
  </tr>
</table>

### Right Now, at a glance

Who's home, what everyone is doing right now and what's next, either as its own card or built into the top of the calendar.

<p align="center">
  <img src="https://raw.githubusercontent.com/JVarhol/HA-Family-Hub/main/images/readme/calendar-right-now.webp" alt="The calendar with the Right Now bar along the top showing each person's current event and Home/Away status" width="100%" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/JVarhol/HA-Family-Hub/main/images/readme/card-rightnow.webp" alt="The Right Now card in the Liquid Glass Dark theme" width="100%" /><br />
  <sub><b>Right Now card</b>: presence, battery and any other sensor per person (Liquid Glass Dark)</sub>
</p>

### Chores, rewards and lists

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/JVarhol/HA-Family-Hub/main/images/readme/card-chores.webp" alt="The Chores board with a column per person" /><br /><sub><b>Chores</b>: a column per person, stars for every job, "Mark in progress"</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/JVarhol/HA-Family-Hub/main/images/readme/card-rewards.webp" alt="The Rewards card with star balances and a reward catalog" /><br /><sub><b>Rewards</b>: spend stars on rewards you set up (Blossom theme)</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/JVarhol/HA-Family-Hub/main/images/readme/card-todo.webp" alt="The To-Do Lists card showing groceries and errands" /><br /><sub><b>To-Do lists</b>: any Home Assistant to-do list, side by side (Slate)</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/JVarhol/HA-Family-Hub/main/images/readme/more-menu-popup.webp" alt="A Guest Wi-Fi pop-up with a QR code" /><br /><sub><b>Your own buttons</b>: e.g. a Guest Wi-Fi QR code, babysitter info or emergency contacts</sub></td>
  </tr>
</table>

### Today card and phones

<table>
  <tr>
    <td width="40%"><img src="https://raw.githubusercontent.com/JVarhol/HA-Family-Hub/main/images/readme/card-today.webp" alt="The Today card in the HA Light theme" /><br /><sub><b>Today card</b>: today's events, meals and reminders, for any dashboard (HA Light)</sub></td>
    <td width="60%"><img src="https://raw.githubusercontent.com/JVarhol/HA-Family-Hub/main/images/readme/phone.webp" alt="The calendar on a phone in the Liquid Glass and HA Dark themes" /><br /><sub><b>On a phone</b>: the calendar stacks into one day at a time (Liquid Glass and HA Dark)</sub></td>
  </tr>
</table>

## Themes

Ten built-in themes, plus every theme you have installed in Home Assistant. Each screen can use its own theme, and the Theme Builder lets you make your own (colours, fonts, glass transparency and blur, background image).

<p align="center">
  <img src="https://raw.githubusercontent.com/JVarhol/HA-Family-Hub/main/images/readme/themes.webp" alt="The week view in all ten built-in themes: Soft, Slate, Meadow, Blossom, VaultTek, Midnight, HA Light, HA Dark, Liquid Glass and Liquid Glass Dark" width="100%" />
</p>

## Features

**Calendar**
- Week, Month, Planner and Agenda layouts, with a choice of how many days and rows to show.
- Any number of Home Assistant calendars. Each person gets a colour, a main calendar, and as many extra calendars as you like merged into their column.
- Add, edit, duplicate and delete events, including repeating events, on calendars that support it.
- Event reminders, checklists, countdowns, multi-person events, weather on each day, and an option to grey out past events.
- Holiday Backgrounds: your own or ready-made holiday photos behind a day, a week or the whole month.

**Meals and recipes**
- One to three meal blocks a day, recurring meals, whole-week templates, and suggestions from dishes you've made before.
- A searchable Recipe Box with ratings, and optional [Grocy](https://grocy.info) integration: a recipe viewer with servings scaling, recipe import from a link or pasted text, shopping lists and pantry tracking.

**Chores, rewards, goals and routines**
- Assigned, rotating or first-come chores that earn stars, a rewards catalog to spend them on, goals, and morning/afternoon/night routines.
- Per-person permissions, Child and Kiosk accounts, and a "Just me" view for each person.

**Right Now, Today and the More menu**
- Right Now shows each person's current and next event, Home/Away, and any sensors or switches you choose.
- Today shows today's events, meals and reminders in a small card.
- Add your own buttons to the More menu: pop-ups with text, photos, links and QR codes (Wi-Fi, contacts, links and more, including your UniFi network's own Wi-Fi QR code). A pop-up can be locked so only chosen people can open it.

**Timers and alarms**
- Timers and alarms that ring on screens, phones and speakers until someone stops them, a Timer log, and actions and events for your automations.

**For a wall tablet**
- Screen Saver with video, camera feed, photos, clock and weather.
- Privacy Mode keeps events behind a PIN lock screen; Discreet Mode hides names and event text but keeps the colours and times.
- Kiosk PIN sign-in, so a shared tablet knows who is using it.

**Also**
- Notifications sent by Home Assistant itself, so they arrive whether or not a dashboard is open: event reminders, reminders, chore due dates and a Daily Digest.
- Settings backups every 12 hours, which you can download and restore.
- Available in English, German, Spanish, French, Italian, Dutch, Polish and Portuguese (Brazil). Each person sees their own Home Assistant language and 12/24-hour clock.

## Installation

Requires a few Home Assistant `todo.*` entities (for the recipe box, meal plan and reminders) and at least one `calendar.*` entity. See [Requirements](DOCUMENTATION.md#requirements) in the full docs.

### Option A: HACS (recommended)

Family Hub isn't in the default HACS store yet, so add it as a custom repository:

1. In Home Assistant, go to HACS → the ⋮ menu (top right) → **Custom repositories**, and add this repository's URL with category **Integration**, or use this one-click link:
   [![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=JVarhol&repository=HA-Family-Hub&category=integration)
2. Find **Family Hub** in HACS and click **Download**.
3. Restart Home Assistant.
4. Settings → Devices & Services → **Add Integration** → search for **Family Hub**, or use this link:
   [![Open your Home Assistant instance and start setting up a new integration.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=family_hub)

### Option B: Manual copy

1. Copy the `custom_components/family_hub` folder into your own `/config/custom_components/` (overwrite an existing install to update it).
2. Restart Home Assistant.
3. Settings → Devices & Services → **Add Integration** → search for **Family Hub**.
4. Add the card(s) you want to a dashboard. See [Card configuration](DOCUMENTATION.md#card-configuration) in the full docs for example YAML.

## Documentation

Full feature detail, the complete `todo`/`calendar` entity requirements, example card YAML for every card, and known limitations are in [DOCUMENTATION.md](DOCUMENTATION.md). Release history is in [CHANGELOG.md](CHANGELOG.md) (older entries in [CHANGELOG_ARCHIVE.md](CHANGELOG_ARCHIVE.md)).

Built to compete with commercial family-hub tablets (Skylight, Dragon Touch and others) while running entirely on your own Home Assistant.

<sub>Screenshots show sample data.</sub>

## License

Copyright (C) 2026 Bordello Labs.

Licensed under the GNU General Public License v3.0 (GPL-3.0); see [LICENSE](LICENSE) for the full text. You're free to use, study, modify, and redistribute this software, provided that any distributed copies (including modified versions) remain under the same license and keep their source available.
