import { expect, test } from 'bun:test';
import {
    Boxes,
    Folder,
    HeartPulse,
    LayoutDashboard,
    ShieldPlus,
    Users,
} from 'lucide-react';
import { sysAdminArea } from '../../../src/platform/access/navigation.ts';
import {
    navigationIcon,
    productIcon,
} from '../../../src/platform/shell/navigation-icons.ts';

test('an app icon comes from its lucide name in the data, and an unknown or missing name gets the default', () => {
    expect(productIcon('heart-pulse')).toBe(HeartPulse);
    expect(productIcon('not-an-icon')).toBe(Boxes);
    expect(productIcon('HeartPulse')).toBe(Boxes);
    expect(productIcon(null)).toBe(Boxes);
    // Nama dari data tidak boleh membuka properti bawaan object.
    expect(productIcon('constructor')).toBe(Boxes);
});

test('a rail group icon comes from its lucide name in the data, and an unknown or missing name gets the folder', () => {
    expect(navigationIcon('layout-dashboard')).toBe(LayoutDashboard);
    expect(navigationIcon('users')).toBe(Users);
    expect(navigationIcon('shield-plus')).toBe(ShieldPlus);
    expect(navigationIcon('not-an-icon')).toBe(Folder);
    expect(navigationIcon(null)).toBe(Folder);
});

test('every Sys Admin icon is one the Shell knows', () => {
    expect(productIcon(sysAdminArea.icon)).not.toBe(Boxes);
    for (const group of sysAdminArea.groups)
        expect(navigationIcon(group.icon ?? null)).not.toBe(Folder);
});
