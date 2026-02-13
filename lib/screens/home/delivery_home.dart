import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../services/order_service.dart';
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

  Future<void> _callCustomer(BuildContext context, String phone) async {
    final uri = Uri(scheme: 'tel', path: phone);
    final launched = await launchUrl(uri);
    if (!launched && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Unable to open dialer')),
      );
    }
  }

  Future<void> _openMaps(BuildContext context, Map<String, dynamic>? address) async {
    if (address == null) return;
    String query;
    final location = address['location'];
    if (location is Map<String, dynamic> &&
        location['lat'] is num &&
        location['lng'] is num) {
      query = '${location['lat']},${location['lng']}';
    } else {
      final flat = (address['flat'] ?? '').toString();
      final apartment = (address['apartment'] ?? '').toString();
      final street = (address['street'] ?? '').toString();
      final area = (address['area'] ?? '').toString();
      query = [flat, apartment, street, area]
          .where((part) => part.trim().isNotEmpty)
          .join(', ');
    }

    if (query.trim().isEmpty) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Address not available')),
        );
      }
      return;
    }

    final uri = Uri.parse(
      'https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(query)}',
    );
    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!launched && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Unable to open maps')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    final phone = _normalizePhone(user?.phoneNumber ?? '');
    if (phone.isEmpty) {
      return const Scaffold(
        body: Center(child: Text('Please sign in')),
      );
    }

    final orderService = OrderService();

    return Scaffold(
      appBar: AppBar(title: const Text('Delivery')),
      drawer: Drawer(
        child: Column(
          children: [
            const DrawerHeader(
              decoration: BoxDecoration(color: Colors.teal),
              child: Align(
                alignment: Alignment.bottomLeft,
                child: Text(
                  'Delivery',
                  style: TextStyle(color: Colors.white, fontSize: 18),
                ),
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
      body: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: orderService.watchAssignedOrdersForDelivery(phone),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text('Error loading orders: ${snapshot.error}'));
          }

          final candidates = _phoneCandidates(phone);
          final docs = (snapshot.data?.docs ?? [])
              .where((doc) =>
                  candidates.contains(
                    (doc.data()['deliveryPhone'] ?? '').toString(),
                  ))
              .toList()
            ..sort((a, b) {
              final aTs = a.data()['createdAt'] as Timestamp?;
              final bTs = b.data()['createdAt'] as Timestamp?;
              final aDate = aTs?.toDate() ?? DateTime.fromMillisecondsSinceEpoch(0);
              final bDate = bTs?.toDate() ?? DateTime.fromMillisecondsSinceEpoch(0);
              return aDate.compareTo(bDate);
            });

          if (docs.isEmpty) {
            return const Center(child: Text('No active orders assigned'));
          }

          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: docs.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final doc = docs[index];
              final data = doc.data();
              final orderId = (data['orderId'] ?? doc.id).toString();
              final name = (data['customerName'] ?? 'Customer').toString();
              final phone = (data['customerPhone'] ?? '').toString();
              final items = (data['items'] as List<dynamic>? ?? [])
                  .cast<Map<String, dynamic>>();
              final details = items
                  .map((item) => '${item['name'] ?? 'Item'} x${item['qty'] ?? 0}')
                  .join(', ');
              final address = data['deliveryAddress'] as Map<String, dynamic>?;
              final addressText = _addressText(address);

              return Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Order: $orderId',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 4),
                      Text('Customer: $name'),
                      Text('Phone: $phone'),
                      const SizedBox(height: 4),
                      Text('Items: $details'),
                      if (addressText.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text('Address: $addressText'),
                      ],
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          OutlinedButton.icon(
                            onPressed: phone.isEmpty
                                ? null
                                : () => _callCustomer(context, phone),
                            icon: const Icon(Icons.call),
                            label: const Text('Call'),
                          ),
                          const SizedBox(width: 8),
                          OutlinedButton.icon(
                            onPressed: address == null
                                ? null
                                : () => _openMaps(context, address),
                            icon: const Icon(Icons.map),
                            label: const Text('Map'),
                          ),
                          const Spacer(),
                          FilledButton(
                            onPressed: () async {
                              await orderService.markDelivered(doc.id);
                              if (!context.mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text('Marked delivered: $orderId'),
                                ),
                              );
                            },
                            child: const Text('Mark Delivered'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }

  String _normalizePhone(String raw) {
    final digits = raw.replaceAll(RegExp(r'\D'), '');
    if (digits.length == 10) return '+91$digits';
    if (digits.length == 12 && digits.startsWith('91')) return '+$digits';
    if (raw.startsWith('+')) return raw;
    return raw;
  }

  List<String> _phoneCandidates(String normalized) {
    final candidates = <String>{};
    candidates.add(normalized);
    final digits = normalized.replaceAll(RegExp(r'\D'), '');
    if (digits.length == 12 && digits.startsWith('91')) {
      final local = digits.substring(2);
      candidates.add(local);
      candidates.add(digits);
      candidates.add('+$digits');
    } else if (digits.length == 10) {
      candidates.add(digits);
      candidates.add('+91$digits');
      candidates.add('91$digits');
    }
    return candidates.toList();
  }

  String _addressText(Map<String, dynamic>? address) {
    if (address == null) return '';
    final flat = (address['flat'] ?? '').toString();
    final apartment = (address['apartment'] ?? '').toString();
    final street = (address['street'] ?? '').toString();
    final area = (address['area'] ?? '').toString();
    return [flat, apartment, street, area]
        .where((part) => part.trim().isNotEmpty)
        .join(', ');
  }
}
