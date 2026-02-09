import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../services/user_service.dart';

class OwnerApprovalsScreen extends StatelessWidget {
  const OwnerApprovalsScreen({super.key});

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
        final pending = docs.where((doc) {
          final data = doc.data();
          final role = data['role'];
          final approved = data['approved'] == true;
          return (role == 'owner' || role == 'delivery') && !approved;
        }).toList();

        if (pending.isEmpty) {
          return const Center(child: Text('No pending approvals'));
        }

        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: pending.length,
          separatorBuilder: (_, __) => const SizedBox(height: 12),
          itemBuilder: (context, index) {
            final doc = pending[index];
            final data = doc.data();
            final phone = data['phone'] ?? 'Unknown';
            final role = data['role'] ?? 'unknown';

            return Card(
              child: ListTile(
                title: Text(phone),
                subtitle: Text('Role: $role'),
                trailing: FilledButton(
                  onPressed: () => userService.setApproved(doc.id, true),
                  child: const Text('Approve'),
                ),
              ),
            );
          },
        );
      },
    );
  }
}
