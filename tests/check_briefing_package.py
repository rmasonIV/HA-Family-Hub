"""Exercise the briefing package in an isolated Home Assistant Core instance."""

import asyncio
import logging
import tempfile
from datetime import timedelta
from pathlib import Path

from homeassistant.bootstrap import async_from_config_dict
from homeassistant import loader
from homeassistant.config import async_hass_config_yaml

from homeassistant.core import HomeAssistant, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.setup import async_setup_component
from homeassistant.util import dt

PACKAGE = Path(__file__).resolve().parents[1] / 'live/packages/family_hub_briefing.yaml'
SENSOR = 'sensor.family_hub_daily_briefing'
HELPER = 'input_boolean.family_hub_briefing_enabled'

async def boot(folder):
    hass = HomeAssistant(folder)
    loader.async_setup(hass)

    config = await async_hass_config_yaml(hass)
    assert await async_from_config_dict(config, hass)
    await hass.async_start()
    await hass.async_block_till_done()
    return hass

async def run(folder):
    hass = await boot(folder)
    try:
        assert await async_setup_component(hass, 'local_calendar', {})
        form = await hass.config_entries.flow.async_init('local_calendar', context={'source':'user'})
        await hass.config_entries.flow.async_configure(form['flow_id'], {'calendar_name': 'Family'})
        await hass.async_block_till_done()
        assert hass.states.get('calendar.family')
        calls = []
        ai_text = '<b>A busy morning</b>'
        async def ai(call):
            calls.append(dict(call.data))
            return {'data': ai_text, 'conversation_id': 'fake'}
        hass.services.async_register('ai_task', 'generate_data', ai, supports_response=SupportsResponse.ONLY)
        async def generate(**data):
            result = await hass.services.async_call('script', 'family_hub_generate_briefing', data,
                                                    blocking=True, return_response=True)
            await hass.async_block_till_done()
            return result

        assert (await generate())['status'] == 'unavailable'
        await hass.services.async_call('input_boolean','turn_on', {'entity_id': HELPER}, blocking=True)
        await hass.async_block_till_done()
        today = dt.now().date()
        # Enabling the helper after the scheduled time catches up immediately.
        assert hass.states.get(SENSOR).state == today.isoformat()
        empty = await generate()
        assert empty['text'].startswith('No events'), empty
        assert not calls
        sensor = hass.states.get(SENSOR)
        assert sensor.state == today.isoformat()
        assert sensor.attributes['briefing'] == empty
        assert await generate() == empty
        for name, start, end in [('Dentist', '09:00:00', '10:00:00'),
                                  ('Practice', '09:30:00', '10:30:00')]:
            await hass.services.async_call('calendar', 'create_event', {
                'entity_id':'calendar.family', 'summary':name, 'description':'private note',
                'start_date_time':f'{today} {start}', 'end_date_time':f'{today} {end}'},
                blocking=True)
        result = await generate()
        assert len(calls) == 1, result
        instructions = calls[0]['instructions']
        assert 'Dentist' in instructions and 'Practice' in instructions and '[[1,2]]' in instructions, instructions
        assert 'private note' not in instructions
        assert await generate() == result
        assert await generate(force_refresh=True) == result
        assert len(calls) == 1
        tomorrow = today + timedelta(days=1)
        future = await generate(briefing_date=tomorrow.isoformat())
        assert future['day'] == tomorrow.isoformat()
        assert hass.states.get(SENSOR).attributes['briefing'] == result
        assert (await generate(briefing_date='2026-02-30'))['status'] == 'unavailable'
        assert len(calls) == 1
        await hass.services.async_call('calendar', 'create_event', {
            'entity_id': 'calendar.family', 'summary': 'Future appointment',
            'start_date_time': f'{tomorrow} 09:00:00', 'end_date_time': f'{tomorrow} 10:00:00'},
            blocking=True)
        await hass.services.async_call('calendar', 'create_event', {
            'entity_id': 'calendar.family', 'summary': 'Holiday',
            'start_date': tomorrow.isoformat(), 'end_date': (tomorrow + timedelta(days=1)).isoformat()},
            blocking=True)
        ai_text = 'No events today.'
        assert (await generate(briefing_date=tomorrow.isoformat()))['status'] == 'ai_error'
        ai_text = '<b>A busy morning</b>'
        future = await generate(briefing_date=tomorrow.isoformat())
        assert future['text'] == '<b>A busy morning</b>'
        assert len(calls) == 3
        assert 'Holiday' in calls[-1]['instructions'] and 'Future appointment' in calls[-1]['instructions']
        assert hass.states.get(SENSOR).attributes['briefing'] == result

        weather_day = tomorrow + timedelta(days=1)
        hass.states.async_set('weather.test_forecast', 'sunny', {'temperature_unit': '°F'})

        async def forecast(call):
            assert call.data['type'] == 'daily'
            return {'weather.test_forecast': {'forecast': [
                {'datetime': tomorrow.isoformat(), 'condition': 'rainy'},
                {'datetime': f'{weather_day}T18:00:00+00:00', 'condition': 'sunny', 'temperature': 72},
            ]}}

        hass.services.async_register('weather', 'get_forecasts', forecast, supports_response=SupportsResponse.ONLY)
        weather_briefing = await generate(briefing_date=weather_day.isoformat())
        assert weather_briefing['status'] == 'ok', weather_briefing
        instructions = calls[-1]['instructions']
        assert 'Events: []' in instructions and '"condition":"sunny"' in instructions, instructions
        assert '"temperature":72' in instructions and 'rainy' not in instructions
        assert len(calls) == 4
        assert hass.states.get(SENSOR).attributes['briefing'] == result
        hass.states.async_remove('weather.test_forecast')

        async def fail(_call):
            raise HomeAssistantError('Synthetic provider failure')

        hass.services.async_register('ai_task', 'generate_data', fail, supports_response=SupportsResponse.ONLY)
        await hass.services.async_call('calendar', 'create_event', {
            'entity_id': 'calendar.family', 'summary': 'Shopping',
            'start_date_time': f'{today} 18:00:00', 'end_date_time': f'{today} 19:00:00'},
            blocking=True)
        await hass.services.async_call('automation', 'trigger', {
            'entity_id': 'automation.family_hub_scheduled_briefing'}, blocking=True)
        await hass.async_block_till_done()
        assert hass.states.get(SENSOR).attributes['briefing'] == result
        assert hass.states.get(SENSOR).attributes['failure'] == {'day': today.isoformat(), 'status': 'unavailable'}
    finally:
        await hass.async_stop()
    hass = await boot(folder)
    try:
        state = hass.states.get(SENSOR)
        assert state.attributes['briefing'] == result, state
        await hass.services.async_call('input_boolean','turn_off', {'entity_id': HELPER}, blocking=True)
        await hass.async_block_till_done()
        assert hass.states.get(SENSOR).state == 'empty'
    finally:
        await hass.async_stop()
    print('Home Assistant smoke test passed')

if __name__ == '__main__':
    logging.basicConfig(level=logging.WARNING)
    with tempfile.TemporaryDirectory(prefix='ha-briefing-') as folder:
        root = Path(folder)
        packages = root / 'packages'
        packages.mkdir()
        (packages / PACKAGE.name).write_text(PACKAGE.read_text()
            .replace('forecast_entity: ""', 'forecast_entity: weather.test_forecast')
            .replace('&briefing_time "05:00:00"', '&briefing_time "00:00:00"'))
        (root / 'configuration.yaml').write_text(
            'homeassistant:\n  time_zone: America/Chicago\n  packages: !include_dir_named packages\n'
            'http:\n  server_host: 127.0.0.1\n'
        )
        asyncio.run(run(folder))
