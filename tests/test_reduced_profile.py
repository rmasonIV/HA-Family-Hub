"""Isolated regression tests: no HA installation, network, or package imports.

Load selected source definitions with stubbed HA decorators/services. This
checks dispatch and side effects without starting the upstream integration.
"""
from __future__ import annotations
import ast
import asyncio
import copy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from functools import wraps

ROOT = Path(__file__).resolve().parents[1]
COMP = ROOT / 'custom_components/family_hub'
spec = importlib.util.spec_from_file_location('reduced_profile', COMP / 'profile.py')
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)

class Unauthorized(Exception): pass

class Connection:
    def __init__(self, admin=False, user_id='child', can_control=False):
        self.user = NS(id=user_id, is_admin=admin, permissions=NS(check_entity=lambda entity, policy: can_control))
        self.results = []
        self.errors = []
    def send_result(self, *args): self.results.append(args)
    def send_error(self, *args): self.errors.append(args)

class Decorators:
    @staticmethod
    def websocket_command(schema):
        def tag(func):
            func._ws_schema = schema
            func._ws_command = schema['type']
            return func
        return tag
    @staticmethod
    def async_response(func):
        # Return the coroutine to the test rather than schedule a live HA task.
        @wraps(func)
        def schedule(*args): return func(*args)
        return schedule
    @staticmethod
    def require_admin(func):
        @wraps(func)
        def gated(hass, connection, msg):
            if connection.user is None or not connection.user.is_admin: raise Unauthorized
            return func(hass, connection, msg)
        return gated

VOL = NS(Required=lambda value: value, Optional=lambda value, **kwargs: value,
         Coerce=lambda value: value, Any=lambda *args: object)

def source_function(filename, name, *, env=None, decorators=False):
    tree = ast.parse((COMP / filename).read_text())
    node = copy.deepcopy(next(n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name))
    if not decorators: node.decorator_list = []
    ns = {'profile': profile, 'websocket_api': Decorators, 'vol': VOL, 'json': json}
    ns.update(env or {})
    code = 'from __future__ import annotations\n' + ast.unparse(node)
    exec(compile(code, str(COMP / filename), 'exec'), ns)
    return ns[name]

async def invoke(func, conn, msg, hass=None):
    result = func(hass, conn, msg)
    if result is not None: await result

class ReducedProfileTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_excluded_commands_dispatch_without_running_original_body(self):
        # No function dependencies supplied: entering any original body fails.
        tree = ast.parse((COMP / '__init__.py').read_text())
        excluded = [n for n in tree.body if isinstance(n, ast.AsyncFunctionDef)
                    and any(ast.unparse(d) == 'profile.disabled_feature' for d in n.decorator_list)]
        self.assertEqual(len(excluded), 54)
        for node in excluded:
            func = source_function('__init__.py', node.name, decorators=True)
            for admin in (False, True):
                conn = Connection(admin=admin)
                await invoke(func, conn, {'id': 1, 'type': func._ws_command})
                self.assertEqual(len(conn.results) + len(conn.errors), 1, node.name)
                self.assertTrue(hasattr(func, '_ws_schema'))

    async def test_non_admin_cannot_replace_security_settings(self):
        fn = source_function('__init__.py', '_ws_set_settings', decorators=True)
        with self.assertRaises(Unauthorized):
            await invoke(fn, Connection(), {'id': 1, 'type': fn._ws_command,
                'settings': {'moreMenu': {'custom': [{'id': 'private', 'locked': True, 'unlockUserIds': ['child']}]}}})

    async def test_oversize_settings_rejected_before_store_access(self):
        fn = source_function('__init__.py', '_ws_set_settings', decorators=True)
        c = Connection(admin=True)
        await invoke(fn, c, {'id': 1, 'type': fn._ws_command,
            'settings': {'data': 'x' * profile.MAX_SETTINGS_BYTES}})
        self.assertEqual(c.errors[0][1], 'invalid_format')

    async def test_all_calendar_mutations_reject_unauthorized_entity(self):
        # Creation's Family Hub check passes; target HA entity control still fails.
        for name in ['_ws_create_calendar_event', '_ws_update_calendar_event', '_ws_delete_calendar_event']:
            fn = source_function('__init__.py', name, env={
                'POLICY_CONTROL': 'control', 'PERMISSION_EDIT_EVENT': 'edit',
                '_get_family_hub_entry_data': lambda hass: {},
                'chores_ws_api': NS(_has_permission=lambda *args: True)})
            c = Connection(can_control=False)
            await invoke(fn, c, {'id': 1, 'entity_id': 'calendar.private'})
            self.assertEqual(c.errors[0][1], 'forbidden', name)

    async def test_calendar_create_requires_family_hub_permission(self):
        fn = source_function('__init__.py', '_ws_create_calendar_event', env={
            'POLICY_CONTROL': 'control', 'PERMISSION_EDIT_EVENT': 'edit',
            '_get_family_hub_entry_data': lambda hass: {},
            'chores_ws_api': NS(_has_permission=lambda *args: False)})
        c = Connection(can_control=True)
        await invoke(fn, c, {'id': 1, 'entity_id': 'calendar.allowed'})
        self.assertEqual(c.errors[0][1], 'forbidden')

    async def test_permitted_calendar_create_still_calls_correct_entity(self):
        calls = []
        async def create(**fields): calls.append(fields)
        entity = NS(supported_features=1, async_create_event=create)
        fn = source_function('__init__.py', '_ws_create_calendar_event', env={
            'POLICY_CONTROL': 'control', 'PERMISSION_EDIT_EVENT': 'edit',
            '_get_family_hub_entry_data': lambda hass: {},
            'chores_ws_api': NS(_has_permission=lambda *args: True),
            'DATA_COMPONENT': 'calendar', 'CalendarEntityFeature': NS(CREATE_EVENT=1),
            '_build_entity_event_fields': lambda fields: fields})
        c = Connection(can_control=True)
        hass = NS(data={'calendar': NS(get_entity=lambda entity_id: entity if entity_id == 'calendar.allowed' else None)})
        await invoke(fn, c, {'id': 1, 'entity_id': 'calendar.allowed', 'event': {'summary': 'Family dinner'}}, hass)
        self.assertEqual(calls, [{'summary': 'Family dinner'}])
        self.assertEqual(c.results, [(1, {'created': True})])

    async def test_privacy_disable_denied_before_mutation(self):
        fn = source_function('chores_websocket_api.py', 'ws_privacy_mode_set', env={
            '_entry_data_or_error': lambda *args: {}, '_has_permission': lambda *args: False,
            'PERMISSION_TOGGLE_PRIVACY_MODE': 'privacy'})
        c = Connection()
        await invoke(fn, c, {'id': 1, 'enabled': False})
        self.assertEqual(c.errors[0][1], 'forbidden')

    async def test_any_authenticated_user_can_make_screen_more_private(self):
        state = {}
        async def set_state(hass, entry, enabled): state['enabled'] = enabled
        fn = source_function('chores_websocket_api.py', 'ws_privacy_mode_set', env={
            '_entry_data_or_error': lambda *args: {},
            'privacy_mode_shared': NS(async_set_privacy_mode=set_state),
            'device_settings_switch': NS(notify_privacy_mode=lambda *args: None)})
        c = Connection()
        await invoke(fn, c, {'id': 1, 'enabled': True})
        self.assertEqual(state, {'enabled': True})
        self.assertFalse(c.errors)

    async def test_zip_installer_never_parses_or_writes_uploaded_content(self):
        installer = source_function('updater.py', 'install_update_from_zip', env={'UpdateError': RuntimeError})
        with self.assertRaisesRegex(RuntimeError, 'disabled'):
            installer('/must/not/write', b'not a zip', '/must/not/back/up')

    async def test_external_wishlist_sync_never_reads_stores_or_network(self):
        sync = source_function('wishlist_links.py', 'async_sync')
        self.assertEqual(await sync(None, {}), {})

    async def test_grocy_sync_and_transports_cannot_use_a_session(self):
        for name in ['_sync_grocy_recipes_to_recipe_box', '_maybe_sync_standard_unit_conversions']:
            fn = source_function('__init__.py', name)
            # A session/HA object would be unusable if the original body ran.
            import inspect
            await fn(*([None] * len(inspect.signature(fn).parameters)))
        fn = source_function('__init__.py', '_grocy_api_get')
        with self.assertRaisesRegex(RuntimeError, 'disabled'):
            await fn(None, 'http://private', 'key', '/api/objects')

    async def test_device_ownership_and_caps_block_side_effects(self):
        store = NS(async_save=lambda value: self.fail('must not save rejected device'))
        base = {'device_settings': {'devices': {'tablet': {'owner_user_id': 'parent'}}}, 'device_settings_store': store}
        fn = source_function('device_settings_websocket_api.py', 'ws_report', env={
            '_entry_data_or_error': lambda *args: base, '_validate_settings': lambda raw: raw})
        c = Connection()
        await invoke(fn, c, {'id': 1, 'device_id': 'tablet', 'settings': {}})
        self.assertEqual(c.errors[0][1], 'forbidden')
        base['device_settings']['devices'] = {str(i): {} for i in range(profile.MAX_DEVICES)}
        c = Connection()
        await invoke(fn, c, {'id': 1, 'device_id': 'new', 'settings': {}})
        self.assertEqual(c.errors[0][1], 'limit_reached')

    async def test_failed_unload_preserves_runtime_state(self):
        state = {'entries': {'one': {'cancel': lambda: self.fail('must not cancel failed unload')}}}
        async def unload(entry, platforms):
            self.assertEqual(set(platforms), set(profile.PLATFORMS))
            return False
        fn = source_function('__init__.py', 'async_unload_entry', env={'DOMAIN': 'family_hub'})
        hass = NS(config_entries=NS(async_unload_platforms=unload), data={'family_hub': state})
        self.assertFalse(await fn(hass, NS(entry_id='one')))
        self.assertIn('one', state['entries'])

    async def test_stolen_elevation_token_cannot_cross_connections(self):
        original = Connection(user_id='kiosk')
        other = Connection(user_id='kiosk')
        elevations = {'secret': {'user_id': 'parent', 'connection': original}}
        async def is_admin(hass, uid): return uid == 'parent'
        fn = source_function('chores_websocket_api.py', '_effective_actor', env={
            '_prune_kiosk_elevations': lambda data: None,
            '_kiosk_elevations': lambda data: elevations,
            '_ha_user_is_admin': is_admin,
            '_actor_id': lambda conn: conn.user.id,
            '_is_admin': lambda conn: conn.user.is_admin})
        self.assertEqual(await fn(None, original, {}, {'elevation_token': 'secret'}), ('parent', True))
        self.assertEqual(await fn(None, other, {}, {'elevation_token': 'secret'}), ('kiosk', False))

    async def test_legitimate_device_enrollment_still_saves_owned_record(self):
        from datetime import datetime, timezone
        records = {}
        saved = []
        async def save(value): saved.append(copy.deepcopy(value))
        data = {'device_settings': {'devices': records}, 'device_settings_store': NS(async_save=save)}
        make_record = source_function('device_settings_websocket_api.py', '_device_record')
        fn = source_function('device_settings_websocket_api.py', 'ws_report', env={
            '_entry_data_or_error': lambda *args: data,
            '_validate_settings': lambda raw: raw,
            '_device_record': make_record,
            '_DEVICE_NAME_MAX_LEN': 80,
            'dt_util': NS(utcnow=lambda: datetime.now(timezone.utc)),
            '_sync_device_entities': lambda *args: None})
        c = Connection(user_id='kiosk')
        await invoke(fn, c, {'id': 1, 'device_id': 'tablet', 'settings': {}, 'device_name': 'Family screen'})
        self.assertEqual(records['tablet']['owner_user_id'], 'kiosk')
        self.assertEqual(len(saved), 1)
        self.assertFalse(c.errors)

    async def test_privacy_switch_permission_blocks_authenticated_service_bypass(self):
        import sys
        from types import ModuleType
        from unittest.mock import patch
        exceptions = ModuleType('homeassistant.exceptions')
        exceptions.HomeAssistantError = RuntimeError
        constants = ModuleType('reduced_tests.const')
        constants.PERMISSION_TOGGLE_PRIVACY_MODE = 'privacy'
        async def user(uid): return NS(is_admin=False)
        fn = source_function('privacy_mode_shared.py', 'async_require_privacy_unlock', env={'__package__': 'reduced_tests'})
        with patch.dict(sys.modules, {'homeassistant.exceptions': exceptions, 'reduced_tests.const': constants}):
            hass = NS(auth=NS(async_get_user=user))
            with self.assertRaisesRegex(RuntimeError, 'cannot disable'):
                await fn(hass, {'permissions': {}}, NS(user_id='child'))
            await fn(hass, {'permissions': {'child': {'privacy': True}}}, NS(user_id='child'))
            await fn(hass, {'permissions': {}}, NS(user_id=None))

    def test_no_automatic_external_fonts_or_duplicate_root_scripts(self):
        self.assertFalse(list(COMP.glob('*.js')))
        for path in (COMP / 'card').glob('*.js'):
            self.assertNotIn('fonts.googleapis.com', path.read_text())
        self.assertFalse(list(COMP.rglob('*.pyc')))

    def test_excluded_jobs_are_not_started_by_setup(self):
        tree = ast.parse((COMP / '__init__.py').read_text())
        setup = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'async_setup_entry')
        body = ast.unparse(setup)
        for forbidden in ['wishlist_links.async_sync(', 'companion.Companion(', '_maybe_sync_standard_unit_conversions(', '_schedule_my_chores_migration(']:
            self.assertNotIn(forbidden, body)

if __name__ == '__main__': unittest.main()
