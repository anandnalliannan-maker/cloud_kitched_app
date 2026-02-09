import 'package:flutter/material.dart';

import '../customer/customer_menu.dart';
import '../customer/customer_profile.dart';

class CustomerHomeScreen extends StatelessWidget {
  const CustomerHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Customer')),
      body: const CustomerMenuScreen(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const CustomerProfileScreen()),
          );
        },
        icon: const Icon(Icons.person),
        label: const Text('Profile'),
      ),
    );
  }
}
