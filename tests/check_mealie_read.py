"""Exercise Family Hub's Mealie bridge against Home Assistant Core."""

from datetime import date
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

from homeassistant.auth.permissions.const import POLICY_READ
from homeassistant.components.mealie import services as native_mealie
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, SupportsResponse

from custom_components.family_hub import mealie_read


class MealieReadTests(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.hass = HomeAssistant(folder.name)
        self.hass.config_entries = Mock()
        self.connection = Mock()
        self.connection.user.id = "dashboard-user"
        self.calendar = "calendar.mealie_dinner"
        self.settings = {
            "calendar": self.calendar, "url": "https://meals.example.test",
            "group": "home", "browse": True,
        }
        self.mealie = SimpleNamespace(
            domain="mealie", entry_id="mealie-entry", state=ConfigEntryState.LOADED,
            runtime_data=SimpleNamespace(client=SimpleNamespace(
                get_recipe_favorites=AsyncMock(return_value=SimpleNamespace(ratings=[
                    SimpleNamespace(recipe_id=f"recipe-{i}", is_favorite=i != 2)
                    for i in range(12)
                ])),
            )),
        )
        hub = SimpleNamespace(
            state=ConfigEntryState.LOADED,
            options={mealie_read.OPTION: self.settings},
        )
        registry = Mock()
        registry.async_get.return_value = SimpleNamespace(
            domain="calendar", platform="mealie", translation_key="dinner",
            config_entry_id=self.mealie.entry_id, disabled=False,
        )
        for target in (
            patch.object(self.hass.config_entries, "async_entries", return_value=[hub]),
            patch.object(self.hass.config_entries, "async_get_entry", return_value=self.mealie),
            patch.object(mealie_read.er, "async_get", return_value=registry),
        ):
            target.start()
            self.addCleanup(target.stop)
        self.registry = registry
        self.calls = []

        async def service(call):
            self.calls.append(call)
            if call.service == "get_mealplan":
                return {"mealplan": [{
                    "mealplan_date": call.data["start_date"], "entry_type": "dinner",
                    "recipe": {"recipe_id": "planned", "slug": "planned-dinner"},
                }]}
            if call.service == "get_recipes":
                return {"recipes": {"items": [{"name": "Pasta", "slug": "pasta", "secret": "excluded"}]}}
            recipe_id = call.data["recipe_id"]
            return {"recipe": {"name": recipe_id, "slug": recipe_id, "recipe_id": recipe_id}}

        for action in ("get_mealplan", "get_recipe", "get_recipes"):
            self.hass.services.async_register(
                "mealie", action, service, supports_response=SupportsResponse.ONLY,
            )

    async def request(self, operation, **data):
        msg = mealie_read.ws_read._ws_schema({
            "id": 1, "type": "family_hub/mealie_read", "operation": operation,
            "calendar": self.calendar, **data,
        })
        await mealie_read.ws_read.__wrapped__(self.hass, self.connection, msg)

    async def test_denied_calendar_cannot_read_settings_or_meals(self):
        self.connection.user.permissions.check_entity.return_value = False
        await self.request("settings")
        await self.request("mealplan", value="2026-11-27")
        self.connection.user.permissions.check_entity.assert_called_with(self.calendar, POLICY_READ)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.connection.send_error.call_count, 2)
        self.connection.send_result.assert_not_called()

    async def test_reads_only_the_bound_mealie_connection_and_date(self):
        await self.request("settings")
        self.connection.send_result.assert_called_once_with(1, self.settings)
        await self.request("mealplan", value="2026-11-27")
        call = self.calls[0]
        self.assertEqual(call.context.user_id, "dashboard-user")
        self.assertEqual(call.data, {
            "config_entry_id": "mealie-entry",
            "start_date": date(2026, 11, 27), "end_date": date(2026, 11, 27),
        })
        await self.request("mealplan", calendar="calendar.other", value="2026-11-27")
        self.assertEqual(len(self.calls), 1)

    async def test_search_and_native_favorites_require_browsing_opt_in(self):
        self.settings["browse"] = False
        await self.request("search", value="Pasta")
        await self.request("favorites")
        self.assertEqual(self.calls, [])
        self.assertEqual(self.connection.send_error.call_count, 2)
        self.settings["browse"] = True
        await self.request("search", value=" Pasta ")
        self.assertEqual(self.calls[0].data["search_terms"], "Pasta")
        self.assertEqual(self.calls[0].data["result_limit"], 100)
        self.assertNotIn("secret", self.connection.send_result.call_args.args[1]["items"][0])
        await self.request("favorites", page=1)
        first = self.connection.send_result.call_args.args[1]
        self.assertEqual(len(first["items"]), 8)
        self.assertTrue(first["has_more"])
        self.assertNotIn("recipe-2", [item["recipe_id"] for item in first["items"]])
        await self.request("favorites", page=2)
        second = self.connection.send_result.call_args.args[1]
        self.assertEqual(len(second["items"]), 3)
        self.assertFalse(second["has_more"])

    async def test_rejects_invalid_mealie_calendars_and_link_credentials(self):
        self.registry.async_get.return_value.translation_key = "breakfast"
        await self.request("settings")
        self.connection.send_error.assert_called_once()
        self.assertFalse(mealie_read.valid_link("https://user:password@meals.example.test", "home"))
        self.assertFalse(mealie_read.valid_link("https://meals.example.test?token=secret", "home"))
        self.assertTrue(mealie_read.valid_link("https://meals.example.test", "home"))


    async def test_recipe_reads_follow_dinner_link_when_browsing_is_disabled(self):
        self.settings["browse"] = False
        await self.request("recipe", value="hidden-recipe", day="2026-11-27")
        self.assertEqual([call.service for call in self.calls], ["get_mealplan"])
        self.connection.send_error.assert_called_once()
        await self.request("recipe", value="planned", day="2026-11-27")
        self.assertEqual(self.calls[-1].service, "get_recipe")
        self.assertEqual(self.calls[-1].data["recipe_id"], "planned")

    async def test_uses_home_assistants_native_mealplan_schema_and_client(self):
        self.hass.services.async_remove("mealie", "get_mealplan")
        self.mealie.runtime_data.client.get_mealplans = AsyncMock(
            return_value=SimpleNamespace(items=[]),
        )
        native_mealie.async_setup_services(self.hass)
        await self.request("mealplan", value="2026-11-27")
        self.mealie.runtime_data.client.get_mealplans.assert_awaited_once_with(
            date(2026, 11, 27), date(2026, 11, 27),
        )
        self.connection.send_result.assert_called_once_with(1, {"mealplan": []})
