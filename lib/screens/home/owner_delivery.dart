import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../services/user_service.dart';

class OwnerDeliveryScreen extends StatelessWidget {
  const OwnerDeliveryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final userService = UserService();

    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: userService.watchUsers(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        final docs = snapshot.data?.docs ?? [];
        final deliveryUsers = docs.where((doc) {
          final data = doc.data();
          final role = data['role'];
          final approved = data['approved'] == true;
          return role == 'delivery' && approved;
        }).toList();

        if (deliveryUsers.isEmpty) {
          return const Center(child: Text('No delivery users yet'));
        }

        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: deliveryUsers.length,
          separatorBuilder: (_, __) => const SizedBox(height: 12),
          itemBuilder: (context, index) {
            final doc = deliveryUsers[index];
            final data = doc.data();
            final phone = data['phone'] ?? 'Unknown';
            final active = data['active'] == true;

            return Card(
              child: ListTile(
                title: Text(phone),
                subtitle: Text(active ? 'Active' : 'Disabled'),
                trailing: Switch(
                  value: active,
                  onChanged: (value) => userService.setActive(doc.id, value),
                ),
              ),
            );
          },
        );
      },
    );
  }
}
