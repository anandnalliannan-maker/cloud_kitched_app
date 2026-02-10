import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../role_select_screen.dart';
import 'owner_approvals.dart';
import 'owner_delivery.dart';
import 'owner_menu.dart';
import 'owner_orders.dart';
import 'owner_areas.dart';
import 'owner_published_menus.dart';

class OwnerHomeScreen extends StatefulWidget {
  const OwnerHomeScreen({super.key});

  @override
  State<OwnerHomeScreen> createState() => _OwnerHomeScreenState();
}

class _OwnerHomeScreenState extends State<OwnerHomeScreen> {
  int _index = 0;

  final _pages = const [
    OwnerMenuScreen(),
    OwnerOrdersScreen(),
  ];

  Future<void> _logout() async {
    await FirebaseAuth.instance.signOut();
    if (mounted) {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const RoleSelectScreen()),
        (_) => false,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Owner')),
      drawer: Drawer(
        child: Column(
          children: [
            const DrawerHeader(
              decoration: BoxDecoration(color: Colors.teal),
              child: Text(
                'Owner Menu',
                style: TextStyle(color: Colors.white, fontSize: 18),
              ),
            ),
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  ListTile(
                    leading: const Icon(Icons.verified_user),
                    title: const Text('Approvals'),
                    onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const OwnerApprovalsScreen()),
                      );
                    },
                  ),
                  ListTile(
                    leading: const Icon(Icons.delivery_dining),
                    title: const Text('Delivery'),
                    onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const OwnerDeliveryScreen()),
                      );
                    },
                  ),
                  ListTile(
                    leading: const Icon(Icons.place),
                    title: const Text('Set Area'),
                    onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const OwnerAreasScreen()),
                      );
                    },
                  ),
                  ListTile(
                    leading: const Icon(Icons.event_note),
                    title: const Text('Published Menus'),
                    onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const OwnerPublishedMenusScreen()),
                      );
                    },
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.logout),
              title: const Text('Log out'),
              onTap: _logout,
            ),
          ],
        ),
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _index,
        onTap: (value) => setState(() => _index = value),
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.restaurant_menu),
            label: 'Menu',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.receipt_long),
            label: 'Orders',
          ),
        ],
      ),
      body: _pages[_index],
    );
  }
}
