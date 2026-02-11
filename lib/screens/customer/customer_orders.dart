import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../services/order_service.dart';

class CustomerOrdersScreen extends StatelessWidget {
  const CustomerOrdersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      return const Scaffold(
        body: Center(child: Text('Please sign in')),
      );
    }

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Order History'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Active'),
              Tab(text: 'Closed'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _OrdersList(
              customerId: user.uid,
              statuses: const ['new', 'assigned'],
              emptyText: 'No active orders',
            ),
            _OrdersList(
              customerId: user.uid,
              statuses: const ['delivered'],
              emptyText: 'No closed orders',
            ),
          ],
        ),
      ),
    );
  }
}

class _OrdersList extends StatelessWidget {
  const _OrdersList({
    required this.customerId,
    required this.statuses,
    required this.emptyText,
  });

  final String customerId;
  final List<String> statuses;
  final String emptyText;

  @override
  Widget build(BuildContext context) {
    final service = OrderService();

    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: service.watchOrdersForCustomer(
        customerId: customerId,
      ),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return Center(
            child: Text(
              'Error loading orders: ${snapshot.error}',
              textAlign: TextAlign.center,
            ),
          );
        }
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        final allOrders = (snapshot.data?.docs ?? []).toList()
          ..sort((a, b) {
            final aTs = a.data()['createdAt'] as Timestamp?;
            final bTs = b.data()['createdAt'] as Timestamp?;
            final aDate = aTs?.toDate() ?? DateTime.fromMillisecondsSinceEpoch(0);
            final bDate = bTs?.toDate() ?? DateTime.fromMillisecondsSinceEpoch(0);
            return bDate.compareTo(aDate);
          });
        final orders = allOrders.where((doc) {
          final status = (doc.data()['status'] ?? '').toString();
          return statuses.contains(status);
        }).toList();
        if (orders.isEmpty) {
          return Center(child: Text(emptyText));
        }

        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: orders.length,
          separatorBuilder: (_, __) => const SizedBox(height: 12),
          itemBuilder: (context, index) {
            final doc = orders[index];
            final data = doc.data();
            final orderId = (data['orderId'] ?? doc.id).toString();
            final status = (data['status'] ?? 'new').toString();
            final total = data['total'] ?? 0;
            final deliveryType = (data['deliveryType'] ?? '').toString();
            final createdAt = (data['createdAt'] as Timestamp?)?.toDate();
            final items = (data['items'] as List<dynamic>? ?? [])
                .cast<Map<String, dynamic>>();
            final deliveryAddress =
                (data['deliveryAddress'] as Map<String, dynamic>?);

            final itemSummary = items.isEmpty
                ? 'No items'
                : items
                    .map((item) {
                      final name = item['name'] ?? 'Item';
                      final qty = item['qty'] ?? 0;
                      return '$name x$qty';
                    })
                    .join(', ');

            return Card(
              child: ListTile(
                title: Text('$orderId | INR $total | ${_statusLabel(status)}'),
                subtitle: Text(
                  '$itemSummary\n'
                  '${_deliveryLabel(deliveryType)}'
                  '${createdAt == null ? '' : ' | ${_formatDate(createdAt)}'}'
                  '${_addressLine(deliveryType, deliveryAddress)}',
                ),
                isThreeLine: true,
              ),
            );
          },
        );
      },
    );
  }

  String _statusLabel(String status) {
    switch (status) {
      case 'assigned':
        return 'Assigned';
      case 'delivered':
        return 'Delivered';
      default:
        return 'New';
    }
  }

  String _deliveryLabel(String deliveryType) {
    switch (deliveryType) {
      case 'pickup':
        return 'Self Pickup';
      case 'delivery':
      default:
        return 'Home Delivery';
    }
  }

  String _formatDate(DateTime date) {
    final local = date.toLocal();
    final y = local.year.toString().padLeft(4, '0');
    final m = local.month.toString().padLeft(2, '0');
    final d = local.day.toString().padLeft(2, '0');
    final hh = local.hour.toString().padLeft(2, '0');
    final mm = local.minute.toString().padLeft(2, '0');
    return '$y-$m-$d $hh:$mm';
  }

  String _addressLine(
    String deliveryType,
    Map<String, dynamic>? deliveryAddress,
  ) {
    if (deliveryType != 'delivery' || deliveryAddress == null) return '';
    final flat = (deliveryAddress['flat'] ?? '').toString();
    final apartment = (deliveryAddress['apartment'] ?? '').toString();
    final street = (deliveryAddress['street'] ?? '').toString();
    final area = (deliveryAddress['area'] ?? '').toString();
    final parts = <String>[
      if (flat.isNotEmpty) flat,
      if (apartment.isNotEmpty) apartment,
      if (street.isNotEmpty) street,
      if (area.isNotEmpty) area,
    ];
    if (parts.isEmpty) return '';
    return '\nAddress: ${parts.join(', ')}';
  }
}
