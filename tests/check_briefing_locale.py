"""Exercise the managed briefing with Home Assistant Core and synthetic services."""

import json
from datetime import datetime
from tempfile import TemporaryDirectory
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

from homeassistant.core import HomeAssistant
from homeassistant.util import dt

from custom_components.family_hub.briefing import Briefing, _briefing_locale


class BriefingLocaleTests(IsolatedAsyncioTestCase):
    async def test_prompt_is_localized_and_service_and_storage_dates_stay_iso(self):
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        hass = HomeAssistant(folder.name)
        hass.config.language, hass.config.country = "en", "US"
        hass.states.async_set("calendar.family", "off")
        hass.states.async_set("ai_task.family", "ready")
        briefing = Briefing(hass, "test", {
            "enabled": True,
            "calendars": ["calendar.family"],
            "ai_task": "ai_task.family",
            "include_titles": True,
        })
        zone = ZoneInfo("America/Chicago")
        now = datetime(2026, 11, 22, 8, tzinfo=zone)
        events = [
            {"start": "2026-11-22", "end": "2026-11-23", "summary": "Holiday"},
            {"start": "2026-11-22T21:30:00+00:00", "end": "2026-11-22T23:30:00+00:00", "summary": "Practice"},
            {"start": "2026-11-22T22:30:00+00:00", "end": "2026-11-23T06:30:00+00:00", "summary": "Festival"},
        ]

        async def call(domain, service, data, context):
            if domain == "calendar":
                self.assertEqual(service, "get_events")
                self.assertEqual(data["start_date_time"], "2026-11-22T00:00:00-06:00")
                self.assertEqual(data["end_date_time"], "2026-11-23T00:00:00-06:00")
                return {"calendar.family": {"events": events}}
            self.assertEqual((domain, service), ("ai_task", "generate_data"))
            return {"data": "A busy day"}

        with (
            patch.object(dt, "now", return_value=now),
            patch.object(dt, "DEFAULT_TIME_ZONE", zone),
            patch.object(briefing, "_call", side_effect=call) as services,
            patch.object(briefing.store, "async_save", new_callable=AsyncMock) as save,
        ):
            result = await briefing.async_generate(now.date())
            self.assertEqual(result["day"], "2026-11-22")
            self.assertEqual(result["generated_at"], "2026-11-22T08:00:00-06:00")
            self.assertEqual(save.await_args.args[0]["briefing"], result)
            instructions = services.await_args.args[2]["instructions"]
            self.assertIn("Sunday, November 22, 2026", instructions)
            self.assertIn("Potential overlaps: [[2, 3]]", instructions)
            rows = json.loads(instructions.split("Events: ", 1)[1].splitlines()[0])
            self.assertEqual(rows[0], [
                "Sunday, November 22, 2026", "Monday, November 23, 2026", True, "Holiday", "",
            ])
            self.assertEqual(rows[1][0].split(), ["3:30", "PM"])
            self.assertEqual(rows[2][1].split(), ["Monday,", "November", "23,", "2026,", "12:30", "AM"])

            self.assertEqual(await briefing.async_generate(now.date()), result)
            save.assert_awaited_once()
            hass.config.language, hass.config.country = "fr", "FR"
            await briefing.async_generate(now.date())
            self.assertEqual(save.await_count, 2)
            instructions = services.await_args.args[2]["instructions"]
            self.assertIn("dimanche 22 novembre 2026", instructions)
            self.assertIn("15:30", instructions)

    def test_locale_resolution_uses_region_and_falls_back(self):
        self.assertEqual(str(_briefing_locale("en", "GB")), "en_GB")
        self.assertEqual(str(_briefing_locale("en-GB", "US")), "en_GB")
        self.assertEqual(str(_briefing_locale("fr", "XX")), "fr")
        self.assertEqual(str(_briefing_locale("invalid", None)), "en")
