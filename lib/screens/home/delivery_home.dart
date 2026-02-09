import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../role_select_screen.dart';

class DeliveryHomeScreen extends StatelessWidget {
  const DeliveryHomeScreen({super.key});

  Future<void> _logout(BuildContext context) async {
    await FirebaseAuth.instance.signOut();
    if (context.mounted) {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const RoleSelectScreen()),
        (_) => false,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Delivery')),
      drawer: Drawer(
        child: Column(
          children: [
            const DrawerHeader(
              decoration: BoxDecoration(color: Colors.teal),
              child: Text(
                'Delivery',
                style: TextStyle(color: Colors.white, fontSize: 18),
              ),
            ),
            const Expanded(child: SizedBox()),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.logout),
              title: const Text('Log out'),
              onTap: () => _logout(context),
            ),
          ],
        ),
      ),
      body: const Center(child: Text('Delivery Home')),
    );
  }
}
